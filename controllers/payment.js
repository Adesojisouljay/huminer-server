import axios from "axios";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import { emitUserBalanceUpdate } from "../helpers/socket.js";

// Core helper to process and credit a successful deposit
export const processSuccessfulDeposit = async (reference, paystackData = null) => {
    const transaction = await Transaction.findOne({ reference });
    if (!transaction) return { success: false, message: "Transaction not found" };

    if (transaction.status === "success") {
        const user = await User.findById(transaction.user);
        return { success: true, transaction, balance: user?.accountBalance, alreadyProcessed: true };
    }

    let data = paystackData;
    if (!data) {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: { Authorization: `Bearer ${secretKey}` }
        });
        data = response.data?.data;
    }

    if (data?.status === "success") {
        transaction.status = "success";
        transaction.metadata = data;
        await transaction.save();

        const user = await User.findById(transaction.user);
        if (user) {
            user.accountBalance = (user.accountBalance || 0) + transaction.amount;
            await user.save();
            emitUserBalanceUpdate(user._id, user.accountBalance);
        }

        return { success: true, transaction, balance: user?.accountBalance, user };
    }

    return { success: false, message: "Payment was not successful on Paystack" };
};

// Initialize Deposit (Optional if using frontend-only init, but good for tracking pending)
export const initializeDeposit = async (req, res) => {
    try {
        const { amount, email, callbackUrl } = req.body;
        const userId = req.user.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Invalid amount" });
        }

        // Generate reference
        const reference = `HUMINER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const userEmail = email || req.user.email || `${req.user.username || "user"}@huminer.com`;

        // Determine dynamic callback URL
        const origin = req.get("origin") || req.get("referer");
        let safeCallbackUrl = callbackUrl;
        if (!safeCallbackUrl) {
            if (origin && !origin.includes("localhost:3000")) {
                safeCallbackUrl = `${origin.replace(/\/$/, "")}/wallet`;
            } else {
                const clientUrl = process.env.CLIENT_PROD_URL || "https://huminer.adesojisouljay.com";
                safeCallbackUrl = `${clientUrl}/wallet`;
            }
        }

        // Initialize with Paystack standard API
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let accessCode = null;
        let authorizationUrl = null;

        try {
            const paystackRes = await axios.post(
                "https://api.paystack.co/transaction/initialize",
                {
                    email: userEmail,
                    amount: Math.round(amount * 100), // in kobo
                    reference,
                    callback_url: safeCallbackUrl
                },
                {
                    headers: {
                        Authorization: `Bearer ${secretKey}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            if (paystackRes.data?.status && paystackRes.data?.data) {
                accessCode = paystackRes.data.data.access_code;
                authorizationUrl = paystackRes.data.data.authorization_url;
            }
        } catch (paystackErr) {
            console.error("Paystack API initialize error:", paystackErr.response?.data || paystackErr.message);
        }

        // Create Pending Transaction in DB
        const transaction = await Transaction.create({
            user: userId,
            amount: amount, // in Naira
            reference,
            status: "pending",
            type: "deposit",
            metadata: { accessCode, authorizationUrl }
        });

        res.json({
            message: "Initialization successful",
            reference,
            accessCode,
            authorizationUrl,
            publicKey: process.env.PAYSTACK_PUBLIC_KEY,
            amount: amount,
            email: userEmail
        });

    } catch (error) {
        console.error("Initialize deposit error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// Verify Deposit
export const verifyDeposit = async (req, res) => {
    try {
        const { reference } = req.body;
        const userId = req.user.id;

        if (!reference) {
            return res.status(400).json({ message: "No reference provided" });
        }

        const result = await processSuccessfulDeposit(reference);
        if (!result.success) {
            return res.status(400).json({ message: result.message || "Payment verification failed" });
        }

        const user = await User.findById(userId);
        const { password, ...userData } = user ? user.toObject() : {};

        return res.json({
            message: "Deposit successful",
            user: userData,
            balance: result.balance
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Verification error", error: error.message });
    }
};

export const handleWalletCallback = async (req, res) => {
    const reference = req.query.reference || req.query.trxref;
    const isMobileApp = req.query.platform === "mobile" || req.query.mobile === "true";
    let success = false;
    let amount = 0;
    let newBalance = 0;

    if (reference) {
        try {
            const result = await processSuccessfulDeposit(reference);
            if (result.success) {
                success = true;
                amount = result.transaction?.amount;
                newBalance = result.balance;
            }
        } catch (err) {
            console.error("Wallet callback error:", err);
        }
    }

    // If Web browser (not native mobile app), redirect directly back to the Web application!
    if (!isMobileApp) {
        const clientUrl = process.env.CLIENT_PROD_URL || process.env.CLIENT_DEV_URL || "http://localhost:3000";
        return res.redirect(`${clientUrl}/wallet?reference=${reference || ""}`);
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Payment ${success ? "Successful" : "Processing"} - Huminer</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #0b0f19;
      color: #fff;
      font-family: 'Plus Jakarta Sans', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .card {
      background: #151d30;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 40px 24px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .icon-wrapper {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: ${success ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)"};
      color: ${success ? "#10b981" : "#ef4444"};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 36px;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 22px;
      font-weight: 700;
    }
    p {
      color: rgba(255, 255, 255, 0.7);
      font-size: 14px;
      margin: 0 0 24px;
      line-height: 1.5;
    }
    .amount {
      font-size: 32px;
      font-weight: 800;
      color: #fbbf24;
      margin-bottom: 8px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #fbbf24;
      color: #0b0f19;
      font-weight: 700;
      font-size: 15px;
      border-radius: 12px;
      text-decoration: none;
      box-sizing: border-box;
      transition: opacity 0.2s;
      cursor: pointer;
      border: none;
    }
    .btn:active {
      opacity: 0.85;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrapper">${success ? "✓" : "!"}</div>
    ${success ? `
      <div class="amount">₦${amount?.toLocaleString()}</div>
      <h2>Deposit Successful!</h2>
      <p>Your Huminer wallet has been credited successfully.<br>New Balance: <b>₦${newBalance?.toLocaleString()}</b></p>
      <a href="huminer://wallet" class="btn" onclick="returnToApp(event)">Return to Huminer App</a>
    ` : `
      <h2>Transaction Processing</h2>
      <p>We are verifying your transaction. Please return to the Huminer app.</p>
      <a href="huminer://wallet" class="btn" onclick="returnToApp(event)">Return to Huminer App</a>
    `}
  </div>
  <script>
    function returnToApp(e) {
      if (e && e.preventDefault) e.preventDefault();
      // Try native custom scheme first to bring Huminer app to foreground
      window.location.href = "huminer://wallet";

      setTimeout(function() {
        if (window.opener) {
          window.close();
        } else {
          try {
            window.close();
          } catch (err) {
            window.history.back();
          }
        }
      }, 400);
    }

    ${success ? `
    // Auto-trigger deep link after 1.8 seconds to return smoothly to app
    setTimeout(function() {
      window.location.href = "huminer://wallet";
    }, 1800);
    ` : ""}
  </script>
</body>
</html>
    `);
};

// Get Nigerian Banks List from Paystack
export const getBanks = async (req, res) => {
    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        const response = await axios.get("https://api.paystack.co/bank?country=nigeria&perPage=100", {
            headers: { Authorization: `Bearer ${secretKey}` }
        });
        const banks = (response.data?.data || []).map(b => ({
            name: b.name,
            code: b.code,
            slug: b.slug
        }));
        return res.json({ success: true, banks });
    } catch (error) {
        console.error("Error fetching banks:", error.response?.data || error.message);
        return res.status(500).json({ message: "Failed to load banks list" });
    }
};

// Resolve Account Number with Bank Code via Paystack
export const resolveAccount = async (req, res) => {
    try {
        const { accountNumber, bankCode } = req.query;
        if (!accountNumber || !bankCode) {
            return res.status(400).json({ message: "Account number and bank code are required." });
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        const response = await axios.get(
            `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
            { headers: { Authorization: `Bearer ${secretKey}` } }
        );

        if (response.data?.status && response.data?.data) {
            return res.json({
                success: true,
                accountName: response.data.data.account_name,
                accountNumber: response.data.data.account_number
            });
        }
        return res.status(400).json({ message: "Could not resolve bank account details." });
    } catch (error) {
        console.error("Resolve account error:", error.response?.data || error.message);
        return res.status(400).json({
            message: error.response?.data?.message || "Invalid account number or bank code."
        });
    }
};

// Request Withdrawal with automated Paystack Transfer
export const requestWithdrawal = async (req, res) => {
    try {
        const { amount, bankAccountId } = req.body;
        const userId = req.user.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: "Please enter a valid withdrawal amount." });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        if (user.accountBalance < amount) {
            return res.status(400).json({ message: "Insufficient account balance." });
        }

        // Find linked bank account
        const bankAccount = user.bankAccounts?.id(bankAccountId) || user.bankAccounts?.[0];
        if (!bankAccount) {
            return res.status(400).json({ message: "Please add a bank account before withdrawing." });
        }

        // Generate withdrawal reference
        const reference = `HUMINER_WD_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // Debit User Balance immediately
        user.accountBalance -= amount;
        await user.save();

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let recipientCode = bankAccount.recipientCode;

        // Create Paystack transfer recipient if not yet created
        if (!recipientCode) {
            try {
                let codeToUse = bankAccount.bankCode;
                // If bankCode was missing (e.g., added prior to automation), find it by bank name
                if (!codeToUse && bankAccount.bankName) {
                    const banksRes = await axios.get("https://api.paystack.co/bank?country=nigeria&perPage=500", {
                        headers: { Authorization: `Bearer ${secretKey}` }
                    });
                    const found = (banksRes.data?.data || []).find(b => 
                        b.name.toLowerCase().includes(bankAccount.bankName.toLowerCase()) ||
                        bankAccount.bankName.toLowerCase().includes(b.name.toLowerCase()) ||
                        (b.slug && bankAccount.bankName.toLowerCase().includes(b.slug.toLowerCase()))
                    );
                    if (found) {
                        codeToUse = found.code;
                        bankAccount.bankCode = codeToUse;
                    }
                }

                if (codeToUse) {
                    const recipientRes = await axios.post(
                        "https://api.paystack.co/transferrecipient",
                        {
                            type: "nuban",
                            name: bankAccount.accountName,
                            account_number: bankAccount.accountNumber,
                            bank_code: codeToUse,
                            currency: "NGN"
                        },
                        { headers: { Authorization: `Bearer ${secretKey}` } }
                    );

                    if (recipientRes.data?.status && recipientRes.data?.data?.recipient_code) {
                        recipientCode = recipientRes.data.data.recipient_code;
                        bankAccount.recipientCode = recipientCode;
                        await user.save();
                    }
                }
            } catch (recipientErr) {
                console.warn("Transfer recipient creation note:", recipientErr.response?.data?.message || recipientErr.message);
            }
        }

        let transferData = null;
        let transferStatus = "pending";

        // Attempt automated transfer via Paystack Transfer API
        if (recipientCode) {
            try {
                const transferRes = await axios.post(
                    "https://api.paystack.co/transfer",
                    {
                        source: "balance",
                        amount: Math.round(amount * 100), // in kobo
                        recipient: recipientCode,
                        reason: `Huminer Wallet Withdrawal - ${user.username || user.email}`,
                        reference
                    },
                    { headers: { Authorization: `Bearer ${secretKey}` } }
                );

                if (transferRes.data?.status && transferRes.data?.data) {
                    transferData = transferRes.data.data;
                    transferStatus = transferRes.data.data.status === "success" ? "success" : "pending";
                }
            } catch (transferErr) {
                console.error("Paystack transfer error:", transferErr.response?.data || transferErr.message);
                // In test mode without OTP or unfunded balance, Paystack might return an informative message.
                // Keep the withdrawal logged as pending so admin/system can complete it.
                transferData = transferErr.response?.data || { error: transferErr.message };
            }
        }

        // Create Transaction record
        const transaction = await Transaction.create({
            user: userId,
            amount: amount,
            reference,
            status: transferStatus,
            type: "withdrawal",
            metadata: {
                bankName: bankAccount.bankName,
                accountNumber: bankAccount.accountNumber,
                accountName: bankAccount.accountName,
                recipientCode,
                paystackTransfer: transferData
            }
        });

        const { password, ...userData } = user.toObject();

        return res.status(200).json({
            message: `Withdrawal of ₦${amount.toLocaleString()} ${transferStatus === "success" ? "sent" : "initiated"} to ${bankAccount.bankName} (${bankAccount.accountNumber}).`,
            user: userData,
            balance: user.accountBalance,
            transaction
        });

    } catch (error) {
        console.error("Withdrawal error:", error);
        res.status(500).json({ message: "Server error processing withdrawal." });
    }
};

// Webhook listener for Paystack Transfer updates (transfer.success / transfer.failed / transfer.reversed)
export const handlePaystackWebhook = async (req, res) => {
    try {
        const event = req.body;
        if (!event || !event.event) {
            return res.sendStatus(200);
        }

        const { reference } = event.data || {};
        if (!reference) return res.sendStatus(200);

        if (event.event === "charge.success") {
            const metadata = event.data?.metadata;
            if (metadata?.type === "verification_subscription" && metadata?.userId) {
                const user = await User.findById(metadata.userId);
                if (user) {
                    const daysToAdd = Number(metadata.days) || (Number(metadata.durationMonths) ? Number(metadata.durationMonths) * 30 : 30);
                    const baseDate = user.verified && user.verificationExpiresAt && new Date(user.verificationExpiresAt) > new Date()
                        ? new Date(user.verificationExpiresAt)
                        : new Date();
                    user.verified = true;
                    user.verificationExpiresAt = new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
                    await user.save();
                }
                return res.sendStatus(200);
            }
            await processSuccessfulDeposit(reference, event.data);
            return res.sendStatus(200);
        }

        const transaction = await Transaction.findOne({ reference });
        if (!transaction) return res.sendStatus(200);

        if (event.event === "transfer.success") {
            transaction.status = "success";
            transaction.metadata = { ...(transaction.metadata || {}), webhook: event.data };
            await transaction.save();
        } else if (event.event === "transfer.failed" || event.event === "transfer.reversed") {
            transaction.status = "failed";
            transaction.metadata = { ...(transaction.metadata || {}), webhook: event.data };
            await transaction.save();

            // Refund user account balance on transfer failure
            const user = await User.findById(transaction.user);
            if (user) {
                user.accountBalance += transaction.amount;
                await user.save();
            }
        }

        return res.sendStatus(200);
    } catch (err) {
        console.error("Webhook processing error:", err);
        return res.sendStatus(500);
    }
};

// Get User's Transactions (Deposits and Withdrawals)
export const getUserTransactions = async (req, res) => {
    try {
        const userId = req.user.id;
        const transactions = await Transaction.find({ user: userId })
            .sort({ createdAt: -1 })
            .limit(30);

        res.json({
            success: true,
            transactions
        });
    } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).json({ message: "Failed to fetch transactions." });
    }
};
