import axios from 'axios'

const api = axios.create({
  baseURL: '/fund/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResult = any

// 基金列表
export const getFundList = (params: Record<string, unknown>): Promise<ApiResult> =>
  api.get('/fund/list', { params })

export const getFundCategories = (): Promise<ApiResult> =>
  api.get('/fund/categories')

// 深度分析
export const getFundAnalysis = (code: string): Promise<ApiResult> =>
  api.get(`/analysis/${code}`)

export const getManagerStyle = (code: string): Promise<ApiResult> =>
  api.get(`/analysis/${code}/style`)

// 智能推荐
export const postRecommend = (data: Record<string, unknown>): Promise<ApiResult> =>
  api.post('/recommend', data)

export const getMarketOverview = (): Promise<ApiResult> =>
  api.get('/recommend/market')

// 定投回测
export const postDcaBacktest = (data: Record<string, unknown>): Promise<ApiResult> =>
  api.post('/dca/backtest', data)

export const getDcaSuggestion = (code: string): Promise<ApiResult> =>
  api.get(`/dca/suggestion/${code}`)

// 专业分析
export const getProfessionalAnalysis = (code: string): Promise<ApiResult> =>
  api.get(`/professional/${code}`)

export const postCorrelation = (codes: string[]): Promise<ApiResult> =>
  api.post('/professional/correlation', null, { params: { codes } })

export default api
