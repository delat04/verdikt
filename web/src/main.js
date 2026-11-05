import { createApp } from 'vue'
import { createPinia } from 'pinia'
import '@fontsource-variable/inter-tight'
import '@fontsource-variable/jetbrains-mono'
import './styles/main.css'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
app.use(createPinia())

await useAuthStore().init()

app.use(router)
app.mount('#app')
