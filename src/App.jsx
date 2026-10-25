
import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import "./App.css";

const UPI_ID = "prashantdubey1718@okhdfcbank";
const PAYEE_NAME = "Prashant Dubey";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

export function App() {
  const [amount, setAmount] = useState("");
  const [activeAmount, setActiveAmount] = useState("");
  const [paymentId, setPaymentId] = useState(null);
  const [copied, setCopied] = useState(false);

  const [isChecking, setIsChecking] = useState(false);
  const [verifiedData, setVerifiedData] = useState(null);
  const [apiError, setApiError] = useState("");

  const validAmount =
    Number(activeAmount) > 0
      ? Number(activeAmount).toFixed(2)
      : "";

  const upiLink = `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(
    PAYEE_NAME
  )}${validAmount ? `&am=${validAmount}` : ""}&cu=INR`;

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    upiLink
  )}`;

  // Get the current Supabase access token.
  const getAccessToken = async () => {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error("Unable to check your login session.");
    }

    const token = data?.session?.access_token;

    if (!token) {
      throw new Error(
        "Please log in first. A valid Supabase session is required."
      );
    }

    return token;
  };

  // Create a payment record and generate the QR code.
  const handleGenerate = async (e) => {
    e.preventDefault();
    setApiError("");

    if (!BACKEND_URL) {
      setApiError(
        "Backend URL is missing. Set VITE_BACKEND_URL in your environment variables."
      );
      return;
    }

    const numericAmount = Number(amount);

    if (
      !amount.trim() ||
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      setApiError("Please enter a valid amount.");
      return;
    }

    try {
      const token = await getAccessToken();

      const res = await fetch(
        `${BACKEND_URL}/api/create-payment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            amount: numericAmount,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.detail || `Server error (${res.status})`
        );
      }

      if (!data.success || !data.payment_id) {
        throw new Error(
          "The backend did not return a valid payment ID."
        );
      }

      setPaymentId(data.payment_id);
      setActiveAmount(numericAmount.toFixed(2));
      setVerifiedData(null);
      setIsChecking(true);
      setApiError("");
    } catch (error) {
      console.error("Create payment error:", error);
      setApiError(
        error.message || "Unable to connect to the backend."
      );
    }
  };

  // Reset the form for the next payment.
  const handleClear = () => {
    setAmount("");
    setActiveAmount("");
    setPaymentId(null);
    setIsChecking(false);
    setVerifiedData(null);
    setApiError("");
  };

  // Copy the UPI ID.
  const copyUPI = async () => {
    try {
      await navigator.clipboard.writeText(UPI_ID);
      setCopied(true);

      setTimeout(() => setCopied(false), 2000);
    } catch {
      setApiError(
        "Could not copy the UPI ID. Please copy it manually."
      );
    }
  };

  // Check the payment status every 4 seconds.
  useEffect(() => {
    if (
      !isChecking ||
      !paymentId ||
      !activeAmount ||
      verifiedData
    ) {
      return undefined;
    }

    let cancelled = false;
    let requestInProgress = false;
    let intervalId;

    const checkPayment = async () => {
      if (requestInProgress || cancelled) return;

      requestInProgress = true;

      try {
        const token = await getAccessToken();

        const res = await fetch(
          `${BACKEND_URL}/api/check-payment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              payment_id: paymentId,
              amount: Number(activeAmount),
            }),
          }
        );

        const data = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          setApiError(
            data.detail ||
              "Your session is not authorized. Please log in again."
          );
          setIsChecking(false);
          return;
        }

        if (!res.ok) {
          console.error(
            "Payment check failed:",
            res.status,
            data
          );
          return;
        }

        if (data.verified) {
          setVerifiedData(
            data.data || {
              status: "verified",
            }
          );
          setIsChecking(false);
          setApiError("");
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Payment polling error:", error);
        }
      } finally {
        requestInProgress = false;
      }
    };

    // Check immediately, then every 4 seconds.
    checkPayment();
    intervalId = setInterval(checkPayment, 4000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [
    isChecking,
    paymentId,
    activeAmount,
    verifiedData,
  ]);

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>🌞 SUN PAY</h1>
          <p className="subtitle">
            Personal Payment Collector
          </p>
        </header>

        <main className="card">
          <h2>Receive Payment</h2>

          <form
            onSubmit={handleGenerate}
            className="form-group"
          >
            <label htmlFor="amount-input">
              Enter Amount (INR)
            </label>

            <div className="amount-box">
              <span className="currency-symbol">₹</span>

              <input
                id="amount-input"
                type="number"
                min="0.01"
                step="0.01"
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
                style={{
                  width: "100%",
                  marginTop: "10px",
                }}
                disabled={isChecking}
              >
                {isChecking
                  ? "Waiting for Payment..."
                  : "Generate QR Code"}
              </button>
            )}
          </form>

          {apiError && (
            <div
              role="alert"
              style={{
                color: "#b42318",
                fontSize: "13px",
                marginTop: "10px",
                overflowWrap: "anywhere",
              }}
            >
              ⚠️ {apiError}
            </div>
          )}

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
              <div style={{ fontSize: "50px", lineHeight: 1 }}>
                ✅
              </div>

              <h3
                style={{
                  color: "#155724",
                  margin: "10px 0 5px",
                }}
              >
                Payment Received!
              </h3>

              <p
                style={{
                  margin: "5px 0",
                  color: "#28a745",
                  fontWeight: "bold",
                }}
              >
                ₹
                {Number(activeAmount).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                Verified & Saved
              </p>

              {verifiedData.transaction_ref && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#555",
                    overflowWrap: "anywhere",
                  }}
                >
                  <strong>Ref / UTR:</strong>{" "}
                  {verifiedData.transaction_ref}
                </p>
              )}

              {verifiedData.payer_name && (
                <p
                  style={{
                    fontSize: "12px",
                    color: "#555",
                  }}
                >
                  <strong>Payer:</strong>{" "}
                  {verifiedData.payer_name}
                </p>
              )}

              <button
                type="button"
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

          {activeAmount &&
            Number(activeAmount) > 0 &&
            !verifiedData && (
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
                  <strong>
                    ₹
                    {Number(activeAmount).toLocaleString(
                      "en-IN",
                      {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }
                    )}
                  </strong>
                </p>

                <a
                  href={upiLink}
                  className="pay-app-btn"
                  style={{
                    display: "block",
                    textDecoration: "none",
                    textAlign: "center",
                  }}
                >
                  Pay Directly via App
                </a>

                <div
                  style={{
                    marginTop: "15px",
                    textAlign: "center",
                  }}
                >
                  <p
                    style={{
                      fontSize: "14px",
                      color: "#666",
                      margin: "5px 0",
                    }}
                  >
                    ⏳ Waiting for payment confirmation...
                  </p>

                  <small style={{ color: "#888" }}>
                    Checking payment status...
                  </small>
                </div>
              </div>
            )}

          <div
            className="upi-card"
            onClick={copyUPI}
            style={{
              marginTop: "20px",
              cursor: "pointer",
            }}
          >
            <div className="upi-info">
              <small>My UPI ID</small>
              <strong>{UPI_ID}</strong>
            </div>

            <button
              type="button"
              className="copy-btn"
              onClick={(e) => {
                e.stopPropagation();
                copyUPI();
              }}
            >
              {copied ? "Copied! ✓" : "Copy"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
