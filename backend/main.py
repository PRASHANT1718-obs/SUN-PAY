
import os
from decimal import Decimal, InvalidOperation

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client

from email_reader import (
    initialize_mailbox_checkpoint,
    read_latest_new_hdfc_email,
    _save_checkpoint,
)
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SECRET_KEY = os.getenv(
    "SUPABASE_SECRET_KEY", ""
).strip()

if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
    raise RuntimeError(
        "SUPABASE_URL or SUPABASE_SECRET_KEY missing in backend/.env"
    )

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY,
)

OWNER_USER_ID = os.getenv("OWNER_USER_ID", "").strip()

if not OWNER_USER_ID:
    raise RuntimeError("OWNER_USER_ID is missing from backend/.env")

bearer_scheme = HTTPBearer(auto_error=False)


def require_owner(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )

    try:
        response = supabase.auth.get_user(credentials.credentials)
        user = response.user
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired access token",
        )

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid access token",
        )

    if str(user.id) != OWNER_USER_ID:
        raise HTTPException(
            status_code=403,
            detail="Owner access only",
        )

    return user

app = FastAPI(title="SUN PAY Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://sun-pay-omega.vercel.app",

    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# REQUEST MODELS
# --------------------------------------------------

class PaymentRequest(BaseModel):
    amount: Decimal = Field(
        gt=0,
        max_digits=10,
        decimal_places=2,
    )


class CheckPaymentRequest(BaseModel):
    payment_id: int = Field(gt=0)


# --------------------------------------------------
# STARTUP
# --------------------------------------------------

@app.on_event("startup")
def startup():
    try:
        initialize_mailbox_checkpoint()
        print("Email checkpoint initialized.")
    except Exception as exc:
        print("EMAIL CHECKPOINT ERROR:", repr(exc))


# --------------------------------------------------
# HOME
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "success": True,
        "message": "SUN PAY backend is running",
    }


# --------------------------------------------------
# CREATE PAYMENT
# --------------------------------------------------

@app.post("/api/create-payment")
def create_payment(
    request: PaymentRequest,
    owner=Depends(require_owner),
):
    try:
        amount = request.amount.quantize(
            Decimal("0.01")
        )

        if amount <= 0:
            return {
                "success": False,
                "message": "Amount must be greater than zero.",
            }

        result = (
            supabase.table("payments")
            .insert({
                "amount": float(amount),
                "status": "pending",
            })
            .execute()
        )

        if not result.data:
            return {
                "success": False,
                "message": "Payment could not be created.",
            }

        payment = result.data[0]

        return {
            "success": True,
            "payment_id": payment["id"],
            "data": payment,
        }

    except Exception as exc:
        print("CREATE PAYMENT ERROR:", repr(exc))
        return {
            "success": False,
            "message": "Could not create payment. Check backend logs.",
        }


# --------------------------------------------------
# CHECK PAYMENT
# --------------------------------------------------

@app.post("/api/check-payment")
def check_payment(
    request: CheckPaymentRequest,
    owner=Depends(require_owner),
):
    try:
        # Fetch payment record.
        result = (
            supabase.table("payments")
            .select("*")
            .eq("id", request.payment_id)
            .limit(1)
            .execute()
        )

        if not result.data:
            return {
                "verified": False,
                "status": "not_found",
                "message": "Payment not found.",
            }

        payment = result.data[0]

        if payment.get("status") == "verified":
            return {
                "verified": True,
                "status": "verified",
                "message": "Payment is already verified.",
            }

        if payment.get("status") != "pending":
            return {
                "verified": False,
                "status": payment.get("status", "error"),
                "message": "Payment is not pending.",
            }

        target_amount = Decimal(
            str(payment["amount"])
        ).quantize(Decimal("0.01"))

        # Read the newest eligible HDFC credit email.
        try:
            email_data = read_latest_new_hdfc_email()
        except Exception as exc:
            print("EMAIL READING ERROR:", repr(exc))
            return {
                "verified": False,
                "status": "pending",
                "message": (
                    "Could not read HDFC email. "
                    "Check Gmail IMAP configuration and backend logs."
                ),
            }

        if not email_data:
            return {
                "verified": False,
                "status": "pending",
                "message": (
                    "No new eligible HDFC credit email found."
                ),
            }

        transaction = email_data.get("transaction")

        if not isinstance(transaction, dict):
            return {
                "verified": False,
                "status": "error",
                "message": "Invalid email parser result.",
            }

        try:
            received_amount = Decimal(
                str(transaction["amount"])
            ).quantize(Decimal("0.01"))

            transaction_ref = str(
                transaction["upi_transaction_reference_id"]
            ).strip()

        except (
            KeyError,
            ValueError,
            TypeError,
            InvalidOperation,
        ):
            return {
                "verified": False,
                "status": "error",
                "message": "Invalid amount or UPI reference in email.",
            }

        if not transaction_ref or received_amount <= 0:
            return {
                "verified": False,
                "status": "error",
                "message": "Invalid bank transaction details.",
            }

        # Do not accept a bank credit for the wrong amount.
        if received_amount != target_amount:
            # This email does not match this payment. Advance the
            # checkpoint so a different new credit can be considered.
            try:
                _save_checkpoint(email_data["imap_uid"])
            except Exception as exc:
                print("CHECKPOINT ERROR:", repr(exc))

            return {
                "verified": False,
                "status": "pending",
                "message": (
                    "Bank credit amount does not match this payment."
                ),
                "expected_amount": float(target_amount),
                "received_amount": float(received_amount),
            }

        # Check for previously recorded UPI references.
        existing = (
            supabase.table("upi_transactions")
            .select("upi_transaction_reference_id")
            .eq(
                "upi_transaction_reference_id",
                transaction_ref,
            )
            .limit(1)
            .execute()
        )

        if existing.data:
            return {
                "verified": False,
                "status": "pending",
                "message": (
                    "This UPI reference has already been recorded. "
                    "Verification refused."
                ),
            }

        # Save the transaction only after exact amount matching.
        try:
            saved = (
                supabase.table("upi_transactions")
                .insert({
                    "upi_transaction_reference_id": transaction_ref,
                    "transaction_date": transaction.get(
                        "transaction_date"
                    ),
                    "transaction_time": transaction.get(
                        "transaction_time"
                    ),
                    "payer_name": transaction.get("payer_name"),
                })
                .execute()
            )

            if not saved.data:
                return {
                    "verified": False,
                    "status": "error",
                    "message": "Transaction record was not saved.",
                }

        except Exception as exc:
            print("TRANSACTION SAVE ERROR:", repr(exc))
            return {
                "verified": False,
                "status": "error",
                "message": (
                    "Could not save transaction. "
                    "Check the upi_transactions schema."
                ),
            }

        # Mark the payment verified.
        try:
            updated = (
                supabase.table("payments")
                .update({
                    "status": "verified",
                    "upi_reference_id": transaction_ref,
                })
                .eq("id", request.payment_id)
                .eq("status", "pending")
                .execute()
            )

            if not updated.data:
                print(
                    "WARNING: transaction saved, "
                    "but payment update returned no row."
                )
                return {
                    "verified": False,
                    "status": "error",
                    "message": (
                        "Transaction was saved but payment status "
                        "was not updated. Manual reconciliation required."
                    ),
                }

        except Exception as exc:
            print("PAYMENT UPDATE ERROR:", repr(exc))
            return {
                "verified": False,
                "status": "error",
                "message": (
                    "Transaction saved, but payment update failed. "
                    "Manual reconciliation required."
                ),
            }

        # Advance the checkpoint only after successful processing.
        try:
            _save_checkpoint(email_data["imap_uid"])
        except Exception as exc:
            print("CHECKPOINT UPDATE ERROR:", repr(exc))

        return {
            "verified": True,
            "status": "verified",
            "message": "Payment verified successfully.",
            "data": {
                "payment_id": request.payment_id,
                "amount": float(received_amount),
                "transaction_ref": transaction_ref,
                "payer_name": transaction.get("payer_name"),
                "transaction_date": transaction.get(
                    "transaction_date"
                ),
                "transaction_time": transaction.get(
                    "transaction_time"
                ),
            },
        }

    except Exception as exc:
        print("CHECK PAYMENT ERROR:", repr(exc))
        return {
            "verified": False,
            "status": "error",
            "message": "Payment verification failed. Check backend logs.",
        }
