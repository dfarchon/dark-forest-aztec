import type { AutoGasSetting } from "../settings/setting";

/**
 * Diagnostic info about a transaction sent to the webserver for network performance analysis.
 */
export interface NetworkEvent {
  tx_to: string;
  tx_type: string;
  time_exec_called: number;
  auto_gas_price_setting?: string | AutoGasSetting;
  rpc_endpoint?: string;
  tx_hash?: string;
  user_address?: string;
  wait_submit?: number;
  wait_confirm?: number;
  wait_error?: number;
  error?: string;
  parsed_error?: string;
}
