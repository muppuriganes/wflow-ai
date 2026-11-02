"""Upload validation. The file type is decided from the bytes, never from the client's filename
or Content-Type header, and only formats WhatsApp can deliver are accepted."""

import re
import unicodedata
from dataclasses import dataclass

from app.core.errors import AppError

MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024  # WhatsApp's media limit


@dataclass(frozen=True)
class DetectedFile:
    content_type: str
    message_type: str  # image | video | audio | document
    extension: str


def _is_text(data: bytes) -> bool:
    if b"\x00" in data[:8192]:
        return False
    try:
        data[:65536].decode("utf-8")
    except UnicodeDecodeError:
        return False
    return True


def detect(data: bytes, file_name: str) -> DetectedFile:
    head = data[:16]
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if head.startswith(b"\xff\xd8\xff"):
        return DetectedFile("image/jpeg", "image", "jpg")
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return DetectedFile("image/png", "image", "png")
    if head[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return DetectedFile("image/webp", "image", "webp")
    if head.startswith(b"%PDF-"):
        return DetectedFile("application/pdf", "document", "pdf")
    if head.startswith(b"OggS"):
        return DetectedFile("audio/ogg", "audio", "ogg")
    if head.startswith(b"ID3") or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return DetectedFile("audio/mpeg", "audio", "mp3")
    if data[4:8] == b"ftyp":
        return DetectedFile("video/mp4", "video", "mp4")
    if head.startswith(b"PK\x03\x04") and ext in {"docx", "xlsx", "pptx"}:
        types = {
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        }
        return DetectedFile(types[ext], "document", ext)
    if ext in {"txt", "csv"} and _is_text(data):
        return DetectedFile("text/csv" if ext == "csv" else "text/plain", "document", ext)
    raise AppError(
        "This file type is not supported. Send images (JPG, PNG, WebP), PDF, Word/Excel/PowerPoint, "
        "text/CSV, MP3/OGG audio or MP4 video.",
        code="unsupported_file_type",
    )


def safe_file_name(name: str, extension: str) -> str:
    """Display-safe name: no paths, control characters or odd unicode; correct extension."""
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = unicodedata.normalize("NFKC", base)
    base = re.sub(r"[^\w.\- ()]+", "_", base).strip(" ._") or "file"
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return f"{stem[:100]}.{extension}"


def validate_upload(data: bytes, file_name: str) -> tuple[DetectedFile, str]:
    if not data:
        raise AppError("The file is empty", code="empty_file")
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AppError("Files can be at most 16 MB", code="file_too_large")
    detected = detect(data, file_name)
    return detected, safe_file_name(file_name, detected.extension)
