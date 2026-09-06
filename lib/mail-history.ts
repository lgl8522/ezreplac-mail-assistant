export type MailHistoryRecord = {
  id: string;
  createdAt: number;
  shopId: string;
  shopName: string;
  buyerMail: string;
  buyerTranslation: string;
  trackingNumber: string;
  logisticsStatus: string;
  logisticsSummary: string;
  logisticsRecommendation: string;
  customInstruction: string;
  action: string;
  chineseReply: string;
  localizedReply: string;
  targetLanguage: string;
  buyerLanguage: string;
};

export type NewMailHistoryRecord = Omit<MailHistoryRecord, 'createdAt'>;

export type MailHistorySummary = Pick<
  MailHistoryRecord,
  | 'id'
  | 'createdAt'
  | 'shopId'
  | 'shopName'
  | 'trackingNumber'
  | 'action'
  | 'targetLanguage'
> & { preview: string };
