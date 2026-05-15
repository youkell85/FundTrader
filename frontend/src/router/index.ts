import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/home',
  },
  {
    path: '/home',
    name: 'Home',
    component: () => import('../views/Home.vue'),
    meta: { title: '基金列表', icon: 'LayoutGrid' },
  },
  {
    path: '/fund/:code',
    name: 'FundDetail',
    component: () => import('../views/FundDetail.vue'),
    meta: { title: '基金详情', icon: 'BarChart3' },
  },
  {
    path: '/recommend',
    name: 'Recommend',
    component: () => import('../views/Recommend.vue'),
    meta: { title: '智能推荐', icon: 'Sparkles' },
  },
  {
    path: '/dca',
    name: 'DcaBacktest',
    component: () => import('../views/DcaBacktest.vue'),
    meta: { title: '定投回测', icon: 'TrendingUp' },
  },
  {
    path: '/professional',
    name: 'Professional',
    component: () => import('../views/Professional.vue'),
    meta: { title: '专业分析', icon: 'LineChart' },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: () => import('../views/Settings.vue'),
    meta: { title: '设置', icon: 'Settings' },
  },
]

const router = createRouter({
  history: createWebHistory('/fund/'),
  routes,
})

router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || '国元基金智选'} - 国元基金智选`
  next()
})

export default router
