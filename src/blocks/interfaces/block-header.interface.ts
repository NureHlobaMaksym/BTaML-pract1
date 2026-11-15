export interface BlockHeader {
  height: number;
  timestamp: number;
  previousHash: string;
  merkleRoot: string;
  difficulty: number;
  nonce: number;
}
