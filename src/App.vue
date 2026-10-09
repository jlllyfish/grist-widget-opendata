<template>
  <div class="widget">
    <AppHeader />
    <HomeView v-if="view === 'home'" :key="homeKey" @import="view = 'import'" />
    <ImportWizard v-else @home="goHome" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import HomeView from './components/HomeView.vue';
import ImportWizard from './components/ImportWizard.vue';

// Accès complet : le widget crée des tables et des colonnes
window.grist.ready({ requiredAccess: 'full' });

const view = ref<'home' | 'import'>('home');
const homeKey = ref(0); // force le rechargement de la liste au retour

const goHome = () => {
  homeKey.value++;
  view.value = 'home';
};
</script>

<style>
.widget {
  max-width: 48rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;
  text-align: left;
}
</style>
