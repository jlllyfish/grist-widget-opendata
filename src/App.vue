<template>
  <div class="widget">
    <AppHeader />
    <HomeView v-if="view === 'home'" :key="homeKey" @import="openWizard(null)" @edit="openWizard" />
    <ImportWizard v-else :key="wizardKey" :edit="editing" @home="goHome" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { SavedSync } from './sync';
import AppHeader from './components/AppHeader.vue';
import HomeView from './components/HomeView.vue';
import ImportWizard from './components/ImportWizard.vue';

// Accès complet : le widget crée des tables et des colonnes
window.grist.ready({ requiredAccess: 'full' });

const view = ref<'home' | 'import'>('home');
const homeKey = ref(0); // force le rechargement de la liste au retour

const editing = ref<SavedSync | null>(null); // synchronisation en cours de modification
const wizardKey = ref(0);

const openWizard = (sync: SavedSync | null) => {
  editing.value = sync;
  wizardKey.value++;
  view.value = 'import';
};

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
