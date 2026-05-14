<template>
  <div class="min-h-screen bg-bg text-text-primary">
    <router-view />
    <NavBar />
  </div>
</template>

<script setup lang="ts">
import NavBar from './components/NavBar.vue'
</script>
