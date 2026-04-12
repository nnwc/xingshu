export interface LoginStepOneResponse {
  requires_totp: boolean;
  session_token?: string;
  token?: string;
  expires_in?: number;
}

export interface TotpVerifyRequest {
  session_token: string;
  code: string;
}

export interface TotpSetupResponse {
  secret: string;
  qr_code: string;
  backup_codes: string[];
}

export interface TotpStatusResponse {
  enabled: boolean;
}

export interface TotpEnableRequest {
  secret: string;
  backup_codes: string[];
  code: string;
}
