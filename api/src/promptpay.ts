/** Build a Thai PromptPay EMVCo QR payload (phone or 13-digit national ID). */
function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

export function promptPayPayload(rawId: string, amount?: number): string {
  const digits = String(rawId || "").replace(/\D/g, "");
  if (!digits) throw new Error("PromptPay ID is empty");

  let merchantAccount: string;
  if (digits.length >= 13) {
    merchantAccount = tlv("00", "A000000677010111") + tlv("02", digits.slice(0, 13));
  } else {
    let phone = digits;
    if (phone.startsWith("0")) phone = "66" + phone.slice(1);
    if (!phone.startsWith("66")) phone = "66" + phone;
    merchantAccount = tlv("00", "A000000677010111") + tlv("01", phone);
  }

  let payload =
    tlv("00", "01") +
    tlv("01", amount != null ? "12" : "11") +
    tlv("29", merchantAccount) +
    tlv("53", "764") +
    tlv("58", "TH");
  if (amount != null && Number.isFinite(amount)) {
    payload += tlv("54", Number(amount).toFixed(2));
  }
  payload += "6304";
  return payload + crc16ccitt(payload);
}
