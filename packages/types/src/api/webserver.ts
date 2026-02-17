export type WhitelistStatusResponse = {
  whitelisted: boolean;
  position?: string;
  txHash?: string;
  failedAt?: string;
};

export type RegisterResponse = {
  inProgress: boolean;
  success?: boolean;
  error?: string;
};
