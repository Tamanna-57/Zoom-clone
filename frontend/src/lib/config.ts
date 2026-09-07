/** Where the API lives. Set NEXT_PUBLIC_API_URL when the backend is not local. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export const WS_URL = API_URL.replace(/^http/, "ws");

export const MOCK_OTP = process.env.NEXT_PUBLIC_MOCK_OTP ?? "123456";
