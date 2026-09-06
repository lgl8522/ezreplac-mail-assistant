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
};

export type NewMailHistoryRecord = Omit<MailHistoryRecord, 'createdAt'>;
