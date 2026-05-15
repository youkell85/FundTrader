import { useState, useEffect } from "react";

export function useFallbackQuery<T>(
  trpcQuery: { data: T | undefined; isLoading: boolean; isError: boolean },
  fallbackData: T
): { data: T; isLoading: boolean } {
  const [useFallback, setUseFallback] = useState(false);

  useEffect(() => {
    if (trpcQuery.isError) {
      setUseFallback(true);
    }
  }, [trpcQuery.isError]);

  const isLoading = trpcQuery.isLoading && !useFallback;
  const data = useFallback ? fallbackData : (trpcQuery.data || fallbackData);

  return { data, isLoading };
}
