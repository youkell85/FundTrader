/** 
 * 通用错误处理工具
 */

/**
 * 统一错误处理和日志记录函数
 */
export const handleErrorAndLog = (error: unknown, errorMsg: string): void => {
  console.error(`${errorMsg}:`, error);
};

/**
 * 安全执行异步函数，捕获异常并返回默认值
 */
export const safeExecuteAsync = async <T>(
  func: () => Promise<T>,
  defaultValue: T,
  errorMsg: string = "Async execution error"
): Promise<T> => {
  try {
    return await func();
  } catch (error) {
    handleErrorAndLog(error, errorMsg);
    return defaultValue;
  }
};

/**
 * 安全执行同步函数，捕获异常并返回默认值
 */
export const safeExecuteSync = <T>(
  func: () => T,
  defaultValue: T,
  errorMsg: string = "Sync execution error"
): T => {
  try {
    return func();
  } catch (error) {
    handleErrorAndLog(error, errorMsg);
    return defaultValue;
  }
};