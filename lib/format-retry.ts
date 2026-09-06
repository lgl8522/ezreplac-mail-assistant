export const MODEL_FORMAT_ERROR = '模型返回格式异常，请重试。';

export async function withFormatRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isFormatError =
        error instanceof Error && error.message === MODEL_FORMAT_ERROR;
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
