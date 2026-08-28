<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AdminPage from "./admin-page.vue";
import AgentPage from "./agent-page.vue";
import UserPage from "./user-page.vue";

const path = ref(window.location.pathname);
const view = computed(() => path.value.startsWith("/admin")
  ? "admin"
  : path.value.startsWith("/agent")
    ? "agent"
    : "user");

function syncPath(): void {
  path.value = window.location.pathname;
}

onMounted(() => window.addEventListener("popstate", syncPath));
onUnmounted(() => window.removeEventListener("popstate", syncPath));
</script>

<template>
  <AdminPage v-if="view === 'admin'" />
  <AgentPage v-else-if="view === 'agent'" />
  <UserPage v-else />
</template>
