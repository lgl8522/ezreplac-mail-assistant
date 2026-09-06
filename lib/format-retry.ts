export const MODEL_FORMAT_ERROR = '模型返回格式异常，请重试。';

const retryableMessages = [
  MODEL_FORMAT_ERROR,
  '模型未完成回复',
  '模型返回为空',
  '模型返回不完整',
  '未返回完整的三个版本',
  '回复版本格式异常',
  '模型未返回有效邮件翻译',
  '邮件翻译未保持原文换行',
  '邮件翻译存在漏译',
  '未返回完整的三个翻译版本',
  '翻译版本不完整',
  '模型未返回邮件翻译',
];

export function isRetryableFormatError(error: unknown) {
  return (
    error instanceof Error &&
    retryableMessages.some((message) => error.message.includes(message))
  );
}

export async function withFormatRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isFormatError = isRetryableFormatError(error);
      if (!isFormatError || attempt === maxAttempts) {
        if (isFormatError)
          throw new Error(
            `模型连续 ${maxAttempts} 次返回格式异常，请重试或更换模型。`,
          );
        throw error;
      }
    }
  }
  throw new Error('模型请求失败。');
}
