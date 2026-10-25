import email
import imaplib
import json
import os
import re

from datetime import datetime
from decimal import Decimal, InvalidOperation
from email.header import decode_header
from email.utils import parseaddr
from pathlib import Path

from bs4 import BeautifulSoup
from dotenv import load_dotenv






BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

GMAIL_EMAIL = os.getenv("GMAIL_EMAIL", "").strip()
GMAIL_APP_PASSWORD = os.getenv(
    "GMAIL_APP_PASSWORD", ""
).replace(" ", "").strip()

BANK_SENDER_FILTER = os.getenv(
    "BANK_SENDER_FILTER", ""
).strip().lower()

CHECKPOINT_FILE = BASE_DIR / "last_seen_mail_uid.json"






def decode_header_text(value):
    if not value:
        return ""

    output = []

    for part, encoding in decode_header(value):
        if isinstance(part, bytes):
            output.append(
                part.decode(
                    encoding or "utf-8",
                    errors="replace"
                )
            )
        else:
            output.append(str(part))

    return "".join(output)






def get_email_body(message):
    plain_parts = []
    html_parts = []

    if message.is_multipart():
        for part in message.walk():
            if part.get_content_disposition() == "attachment":
                continue

            content_type = part.get_content_type()

            if content_type not in ("text/plain", "text/html"):
                continue

            payload = part.get_payload(decode=True)

            if not payload:
                continue

            charset = part.get_content_charset() or "utf-8"

            try:
                content = payload.decode(
                    charset, errors="replace"
                )
            except LookupError:
                content = payload.decode(
                    "utf-8", errors="replace"
                )

            if content_type == "text/plain":
                plain_parts.append(content)
            else:
                html_parts.append(content)

    else:
        payload = message.get_payload(decode=True)

        if payload:
            charset = message.get_content_charset() or "utf-8"

            try:
                content = payload.decode(
                    charset, errors="replace"
                )
            except LookupError:
                content = payload.decode(
                    "utf-8", errors="replace"
                )

            if message.get_content_type() == "text/html":
                html_parts.append(content)
            else:
                plain_parts.append(content)

    if plain_parts:
        return "\n".join(plain_parts)

    if html_parts:
        return "\n".join(html_parts)

    return ""


def clean_email_text(body):
    if not body:
        return ""

    soup = BeautifulSoup(body, "html.parser")

    text = soup.get_text(" ", strip=True)
    text = text.replace("\xa0", " ")

    return re.sub(r"\s+", " ", text).strip()






def extract_date(text):
    patterns = [
        r"\bDate\s*:\s*(\d{1,2}[/-]\d{1,2}[/-]\d{4})",
        r"\bDate\s*:\s*(\d{4}-\d{2}-\d{2})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)

        if match:
            value = match.group(1)

            for fmt in (
                "%d/%m/%Y",
                "%d-%m-%Y",
                "%Y-%m-%d",
            ):
                try:
                    return datetime.strptime(
                        value, fmt
                    ).strftime("%Y-%m-%d")
                except ValueError:
                    continue

    return None


def extract_time(text):
    patterns = [
        r"\bTime\s*:\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)",
        r"\bTransaction\s+Time\s*:\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)",
    ]

    for pattern in patterns:
        match = re.search(
            pattern, text, re.IGNORECASE
        )

        if match:
            value = re.sub(
                r"\s+", " ", match.group(1)
            ).strip()

            for fmt in ("%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p"):
                try:
                    return datetime.strptime(
                        value.upper(), fmt
                    ).strftime("%H:%M:%S")
                except ValueError:
                    continue

    return None






def parse_hdfc_email(body):
   

    text = clean_email_text(body)

    if not text:
        return None

    lower_text = text.lower()

    
    debit_patterns = [
        r"\bis\s+debited\b",
        r"\bhas\s+been\s+debited\b",
        r"\bdebited\s+from\b",
        r"\bdebit\s+transaction\b",
        r"\bwithdrawn\s+from\b",
    ]

    if any(
        re.search(pattern, lower_text)
        for pattern in debit_patterns
    ):
        print("Rejected bank email: debit notification.")
        return None

    
    credit_patterns = [
        r"\bcredited\b",
        r"\bsuccessfully\s+credited\b",
        r"\bcredit\s+to\s+your\s+account\b",
        r"\breceived\s+in\s+your\s+account\b",
    ]

    if not any(
        re.search(pattern, lower_text)
        for pattern in credit_patterns
    ):
        return None

    
    if "hdfc bank" not in lower_text and "hdfc" not in lower_text:
        return None

    
    amount_match = re.search(
        r"\bRs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)"
        r"|"
        r"\bINR\s*([0-9,]+(?:\.[0-9]{1,2})?)",
        text,
        re.IGNORECASE,
    )

    if not amount_match:
        print("Could not find credit amount in email.")
        return None

    amount_string = (
        amount_match.group(1)
        or amount_match.group(2)
    ).replace(",", "")

    try:
        amount = Decimal(amount_string).quantize(
            Decimal("0.01")
        )
    except InvalidOperation:
        return None

    if amount <= 0:
        return None

    
    reference_patterns = [
        r"UPI\s*Reference\s*(?:No\.?|Number|ID)?\s*[:#-]?\s*(\d{8,})",
        r"UPI\s*Ref(?:erence)?\.?\s*(?:No\.?|Number|ID)?\s*[:#-]?\s*(\d{8,})",
        r"UPI\s*Transaction\s*(?:ID|No\.?|Number)\s*[:#-]?\s*(\d{8,})",
    ]

    transaction_ref = None

    for pattern in reference_patterns:
        match = re.search(
            pattern, text, re.IGNORECASE
        )

        if match:
            transaction_ref = match.group(1)
            break

    if not transaction_ref:
        print("Could not find UPI transaction reference.")
        return None
    payer_name = None
    sender_match = re.search(
        r"\bSender\s*:\s*(.{1,150}?)"
        r"(?=\s+(?:UPI\s+)?Reference\b"
        r"|\s+Date\s*:|\s+Time\s*:|$)",
        text,
        re.IGNORECASE,
    )

    if sender_match:
        sender_value = sender_match.group(1).strip()

        # Remove a trailing VPA, if present.
        sender_value = re.sub(
            r"\s*[\(\[]?[A-Z0-9._-]+@[A-Z0-9.-]+[\)\]]?\s*$",
            "",
            sender_value,
            flags=re.IGNORECASE,
        )

        payer_name = sender_value.strip(" :-()[]") or None

    return {
        "amount": str(amount),
        "upi_transaction_reference_id": transaction_ref,
        "transaction_date": extract_date(text),
        "transaction_time": extract_time(text),
        "payer_name": payer_name,
    }



def _connect_mailbox():
    if not GMAIL_EMAIL or not GMAIL_APP_PASSWORD:
        raise RuntimeError(
            "GMAIL_EMAIL or GMAIL_APP_PASSWORD is missing in .env"
        )

    mail = imaplib.IMAP4_SSL(
        "imap.gmail.com", 993, timeout=30
    )

    try:
        mail.login(GMAIL_EMAIL, GMAIL_APP_PASSWORD)

        status, _ = mail.select("INBOX", readonly=True)

        if status != "OK":
            raise RuntimeError("Could not select Gmail inbox.")

        return mail

    except Exception:
        try:
            mail.logout()
        except Exception:
            pass

        raise






def _load_checkpoint():
    try:
        if not CHECKPOINT_FILE.exists():
            return None

        with CHECKPOINT_FILE.open(
            "r", encoding="utf-8"
        ) as file:
            data = json.load(file)

        return max(0, int(data.get("last_uid", 0)))

    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        print("Checkpoint missing or invalid.")
        return None


def _save_checkpoint(uid):
    temp_file = CHECKPOINT_FILE.with_suffix(".tmp")

    with temp_file.open("w", encoding="utf-8") as file:
        json.dump({"last_uid": int(uid)}, file)

    os.replace(temp_file, CHECKPOINT_FILE)


def initialize_mailbox_checkpoint():
    """
    On first startup, ignore existing emails.
    """

    mail = None

    try:
        mail = _connect_mailbox()

        status, data = mail.uid(
            "search", None, "ALL"
        )

        if status != "OK":
            raise RuntimeError(
                "Could not initialize Gmail UID checkpoint."
            )

        uids = [
            int(item)
            for item in data[0].split()
            if item.isdigit()
        ]

        _save_checkpoint(max(uids) if uids else 0)

        print(
            "Email checkpoint initialized. "
            "Existing emails will be ignored."
        )

    finally:
        if mail is not None:
            try:
                mail.logout()
            except Exception:
                pass






def _is_bank_sender_and_payment_email(sender, body):
    sender_email = parseaddr(sender)[1].lower()
    text = clean_email_text(body).lower()

    if BANK_SENDER_FILTER:
        if BANK_SENDER_FILTER not in sender_email:
            return False

    if "hdfc bank" not in text and "hdfc" not in sender.lower():
        return False

    return True





def read_latest_new_hdfc_email():
   

    last_uid = _load_checkpoint()

    if last_uid is None:
        initialize_mailbox_checkpoint()
        return None

    mail = None

    try:
        mail = _connect_mailbox()

        status, data = mail.uid(
            "search",
            None,
            f"UID {last_uid + 1}:*",
        )

        if status != "OK":
            raise RuntimeError(
                "Could not search for new Gmail messages."
            )

        new_uids = sorted(
            int(item)
            for item in data[0].split()
            if item.isdigit() and int(item) > last_uid
        )

        if not new_uids:
            print("No new emails since last checkpoint.")
            return None

        newest_uid_seen = max(new_uids)


        for uid in reversed(new_uids):
            status, msg_data = mail.uid(
                "fetch", str(uid), "(RFC822)"
            )

            if status != "OK":

                continue

            raw_email = None

            for part in msg_data:
                if isinstance(part, tuple):
                    raw_email = part[1]
                    break

            if not raw_email:
                continue

            message = email.message_from_bytes(raw_email)

            subject = decode_header_text(
                message.get("Subject", "")
            )

            sender = decode_header_text(
                message.get("From", "")
            )

            body = get_email_body(message)

            if not _is_bank_sender_and_payment_email(
                sender, body
            ):
                continue

            transaction = parse_hdfc_email(body)

            if not transaction:
                continue

            print("Eligible HDFC credit email found. UID:", uid)

            return {
                "email_id": (
                    message.get("Message-ID")
                    or f"imap-uid-{uid}"
                ),
                "imap_uid": uid,
                "subject": subject,
                "sender": sender,
                "transaction": transaction,
            }

        # Advance only if no eligible credit was found.
        # Non-bank emails and invalid notifications won't be rescanned.
        _save_checkpoint(newest_uid_seen)

        print("No eligible HDFC credit found in new emails.")
        return None

    finally:
        if mail is not None:
            try:
                mail.logout()
            except Exception:
                pass