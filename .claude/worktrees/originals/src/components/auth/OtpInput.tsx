/**
 * OTP input component for 6-digit verification codes.
 *
 * Features:
 * - 6 individual digit inputs with auto-focus advancement
 * - Paste support for full codes
 * - Backspace navigation between fields
 * - Auto-submit when all digits entered
 * - Resend code functionality with cooldown
 */

import { useState, useRef, useEffect, type KeyboardEvent, type ClipboardEvent, type ChangeEvent } from "react";

interface OtpInputProps {
  /** Called when all 6 digits are entered */
  onComplete: (code: string) => void;
  /** Whether a verification is in progress */
  isLoading?: boolean;
  /** Error message to display */
  error?: string | null;
  /** Called when user requests to resend code */
  onResend?: () => void;
}

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export function OtpInput({ onComplete, isLoading = false, error, onResend }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  // Track submitted code to prevent duplicate submissions
  const submittedCodeRef = useRef<string | null>(null);
  // Use ref for callback to avoid effect re-running on callback change
  const onCompleteRef = useRef(onComplete);

  // Update ref when callback changes (must be done in effect, not during render)
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Focus first input on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Reset submitted code when error occurs so user can retry
  useEffect(() => {
    if (error) {
      submittedCodeRef.current = null;
    }
  }, [error]);

  // Check if code is complete and submit (only once per code)
  useEffect(() => {
    const code = digits.join("");
    if (code.length === OTP_LENGTH && !digits.includes("") && code !== submittedCodeRef.current) {
      submittedCodeRef.current = code;
      onCompleteRef.current(code);
    }
  }, [digits]);

  const handleChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Only allow single digit
    if (value.length > 1) return;

    // Only allow numbers
    if (value && !/^\d$/.test(value)) return;

    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    // Auto-advance to next input
    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === "Backspace") {
      if (!digits[index] && index > 0) {
        // If current field is empty, go back to previous
        const newDigits = [...digits];
        newDigits[index - 1] = "";
        setDigits(newDigits);
        inputRefs.current[index - 1]?.focus();
      }
    }

    // Handle arrow keys
    if (e.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text").trim();

    // Only accept 6 digits
    if (!/^\d{6}$/.test(pastedData)) return;

    const newDigits = pastedData.split("");
    setDigits(newDigits);

    // Focus last input
    inputRefs.current[OTP_LENGTH - 1]?.focus();
  };

  const handleResend = () => {
    if (resendCooldown > 0 || !onResend) return;

    onResend();
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    // Clear existing digits and allow re-submission
    setDigits(Array(OTP_LENGTH).fill(""));
    submittedCodeRef.current = null;
    inputRefs.current[0]?.focus();
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-3 text-center">
        Verification code
      </label>

      <div className="flex justify-center gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            disabled={isLoading}
            className="w-12 h-14 text-center text-2xl font-semibold text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label={`Digit ${index + 1}`}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
      )}

      {isLoading && (
        <p className="mt-3 text-sm text-gray-500 text-center">Verifying...</p>
      )}

      {onResend && (
        <div className="mt-4 text-center">
          {resendCooldown > 0 ? (
            <p className="text-sm text-gray-500">
              Resend code in {resendCooldown}s
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={isLoading}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
            >
              Resend code
            </button>
          )}
        </div>
      )}
    </div>
  );
}
