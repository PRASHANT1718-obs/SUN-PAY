import { useState, useEffect } from "react";
import "./App.css";

const UPI_ID = "prashantdubey1718@okhdfcbank";
const PAYEE_NAME = "Prashant Dubey";
const BACKEND_URL = "http://127.0.0.1:8000";

export function App() {
  const [amount, setAmount] = useState("");
  const [activeAmount, setActiveAmount] = useState("");
  const [paymentId, setPaymentId] = useState(null);
  const [copied, setCopied] = useState(false);

  const [isChecking, setIsChecking] = useState(false);
  const [verifiedData, setVerifiedData] = useState(null);
  const [apiError, setApiError] = useState("");

  const validAmount =
    Number(activeAmount) > 0 ? Number(activeAmount).toFixed(2) : "";
  const upiLink = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(
    PAYEE_NAME,
  )}${validAmount ? `&am=${validAmount}` : ""}&cu=INR`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    upiLink,
  )}`;

  // QR Generate: Create record in Supabase with entered_amount
  const handleGenerate = async (e) => {
    e.preventDefault();
    setApiError("");

    if (!amount || Number(amount) <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      // Fix 1: Properly cleaned template string URL
      const res = await fetch(`${BACKEND_URL}/api/create-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });

      if (!res.ok) {
        const errorDetail = await res.json().catch(() => ({}));
        throw new Error(errorDetail.detail || `Server Error (${res.status})`);
      }

      const data = await res.json();

      if (data.success && data.payment_id) {
        setPaymentId(data.payment_id);
        setActiveAmount(amount);
        setVerifiedData(null);
        setIsChecking(true); // Start polling
      } else {
        throw new Error("Failed to initialize payment record.");
      }
    } catch (err) {
      console.error("Create Payment Error:", err);
      setApiError(err.message || "Error connecting to FastAPI backend.");
      alert(`Backend Error: ${err.message}`);
    }
  };

  const handleClear = () => {
    setAmount("");
    setActiveAmount("");
    setPaymentId(null);
    setIsChecking(false);
    setVerifiedData(null);
    setApiError("");
  };

  const copyUPI = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Failed to copy UPI ID");
    }
  };

  // --- AUTOMATIC EMAIL CHECKING POLLING ---
  useEffect(() => {
    let intervalId;

    if (isChecking && paymentId && activeAmount && !verifiedData) {
      intervalId = setInterval(async () => {
        try {
          // Fix 2: Changed to /api/check-payment and fixed URL string
          const res = await fetch(`${BACKEND_URL}/api/check-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_id: paymentId,
              amount: Number(activeAmount),
            }),
          });

          if (!res.ok) return;

          const data = await res.json();

          if (data.verified) {
            setVerifiedData(data.data || { status: "verified" });
            setIsChecking(false);
            clearInterval(intervalId);
          }
        } catch (error) {
          console.error("Polling error:", error);
        }
      }, 4000);
    }

    return () => clearInterval(intervalId);
  }, [isChecking, paymentId, activeAmount, verifiedData]);

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🌞 SUN PAY</h1>
          <p className="subtitle">Personal Payment Collector</p>
        </header>

        <main className="card">
          <h2>Receive Payment</h2>

          <form onSubmit={handleGenerate} className="form-group">
            <label htmlFor="amount-input">Enter Amount (INR)</label>
            <div className="amount-box">
              <span className="currency-symbol">₹</span>
              <input
                id="amount-input"
                type="number"
                min="1"
                step="any"
                placeholder="Enter amount (e.g. 500)"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isChecking || Boolean(verifiedData)}
              />
              {amount && (
                <button
                  type="button"
                  className="clear-btn"
                  onClick={handleClear}
                >
                  ✕
                </button>
              )}
            </div>

            {!verifiedData && (
              <button
                type="submit"
                className="pay-app-btn"
                style={{ width: "100%", marginTop: "10px" }}
              >
                Generate QR Code
              </button>
            )}
          </form>

          {/* API ERROR ALERT DISPLAY */}
          {apiError && (
            <div
              style={{ color: "#d9534f", fontSize: "13px", marginTop: "10px" }}
            >
              ⚠️ {apiError}
            </div>
          )}

          {/* GREEN TICK DISPLAY WHEN VERIFIED */}
          {verifiedData && (
            <div
              style={{
                marginTop: "20px",
                padding: "20px",
                backgroundColor: "#e6fffa",
                border: "2px solid #28a745",
                borderRadius: "12px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "50px", lineHeight: "1" }}>✅</div>
              <h3 style={{ color: "#155724", margin: "10px 0 5px" }}>
                Payment Received!
              </h3>
              <p
                style={{
                  margin: "5px 0",
                  color: "#28a745",
                  fontWeight: "bold",
                }}
              >
                ₹{Number(activeAmount).toLocaleString("en-IN")} Verified & Saved
              </p>

              {verifiedData.transaction_ref && (
                <p style={{ fontSize: "12px", color: "#555", margin: "5px 0" }}>
                  <strong>Ref / UTR:</strong> {verifiedData.transaction_ref}
                </p>
              )}

              {verifiedData.payer_name && (
                <p style={{ fontSize: "12px", color: "#555", margin: "2px 0" }}>
                  <strong>Payer:</strong> {verifiedData.payer_name}
                </p>
              )}

              <button
                onClick={handleClear}
                style={{
                  marginTop: "15px",
                  padding: "8px 16px",
                  backgroundColor: "#28a745",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                Receive Another Payment
              </button>
            </div>
          )}

          {/* QR CODE AND WAITING STATUS */}
          {activeAmount && Number(activeAmount) > 0 && !verifiedData && (
            <div className="qr-section">
              <div className="qr-wrapper">
                <img
                  src={qrImageUrl}
                  alt="UPI Payment QR Code"
                  width="200"
                  height="200"
                />
              </div>

              <p className="qr-text">
                Scan to pay{" "}
                <strong>₹{Number(activeAmount).toLocaleString("en-IN")}</strong>
              </p>

              <a
                href={upiLink}
                className="pay-app-btn"
                style={{ display: "block", textDecoration: "none" }}
              >
                Pay Directly via App
              </a>

              <div style={{ marginTop: "15px", textAlign: "center" }}>
                <p style={{ fontSize: "14px", color: "#666", margin: "5px 0" }}>
                  ⏳ Waiting for payment confirmation...
                </p>
                <small style={{ color: "#888" }}>
                  Scraping Email & Syncing Supabase DB...
                </small>
              </div>
            </div>
          )}

          <div
            className="upi-card"
            onClick={copyUPI}
            style={{ marginTop: "20px" }}
          >
            <div className="upi-info">
              <small>My UPI ID</small>
              <strong>{UPI_ID}</strong>
            </div>
            <button type="button" className="copy-btn">
              {copied ? "Copied! ✓" : "Copy"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
