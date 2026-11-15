export interface RewardTransaction {
  type: 'reward';
  recipient: string;
  amount: number;
  height: number;
  id: string;
}
