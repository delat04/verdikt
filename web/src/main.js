import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './styles/main.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { vGlide } from './directives/glide'

const app = createApp(App)
app.use(createPinia())
app.directive('glide', vGlide)

useAuthStore().init().finally(() => {
  app.use(router)
  app.mount('#app')
})
