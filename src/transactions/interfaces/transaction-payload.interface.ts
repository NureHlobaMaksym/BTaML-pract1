export interface TransactionPayload {
  type: 'transfer';
  sender: string;
  recipient: string;
  amount: number;
  fee: number;
  nonce: number;
  publicKey: string;
}
