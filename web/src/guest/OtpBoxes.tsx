import { useRef } from "react";
import { t } from "../i18n";
import { OTP_LEN, otpBackspace, otpType, otpValue } from "../lib/p2";

/** One box per digit. Paste, autofill and backspace move across the row. */
export function OtpBoxes({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const slots = Array.from({ length: OTP_LEN }, (_, i) => value[i] ?? "");

  function commit(nextSlots: string[], focus: number, complete: boolean) {
    const next = otpValue(nextSlots);
    onChange(next);
    window.requestAnimationFrame(() => refs.current[focus]?.focus());
    if (complete && next.length === OTP_LEN) onComplete(next);
  }

  return (
    <div className="g-otp-row" role="group" aria-label={t("code.label")}>
      {slots.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="g-otp-box"
          value={digit}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={t("code.digit", { n: i + 1 })}
          disabled={disabled}
          maxLength={OTP_LEN}
          onChange={(e) => {
            const { slots: next, focus } = otpType(slots, i, e.target.value);
            commit(next, focus, otpValue(next).length === OTP_LEN);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Backspace") return;
            e.preventDefault();
            const { slots: next, focus } = otpBackspace(slots, i);
            commit(next, focus, false);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!text) return;
            e.preventDefault();
            const { slots: next, focus } = otpType(slots, i, text);
            commit(next, focus, otpValue(next).length === OTP_LEN);
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </div>
  );
}
