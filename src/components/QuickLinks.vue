<template>
  <div class="quick-links">
    <button
      class="quick-link quick-link-trades"
      :style="{ backgroundColor: '#052e2b', color: '#2dd4bf' }"
      @click="$emit('open-trades')"
    >
      <span>📒 Mis Trades</span>
    </button>

    <button
      class="quick-link quick-link-journal"
      :style="{ backgroundColor: '#1e1b4b', color: '#a5b4fc' }"
      @click="$emit('open-journal')"
    >
      <span>📊 Planilla Pro</span>
    </button>

    <a
      v-for="link in links"
      :key="link.name"
      :href="link.url"
      target="_blank"
      rel="noopener noreferrer"
      class="quick-link"
      :style="{
        backgroundColor: link.bgColor,
        color: link.textColor
      }"
    >
      <span>{{ link.name }}</span>
    </a>
  </div>
</template>

<script setup>
defineEmits(['open-trades', 'open-journal'])

const links = [
  {
    name: 'IOL',
    url: 'https://micuenta.invertironline.com/ingresar?url=https://iol.invertironline.com/MiCuenta/Operaciones',
    bgColor: '#1e1b4b', // Color de fondo personalizado
    textColor: '#818cf8' // Color de letra personalizado
  },
  {
    name: 'Dólar',
    url: 'https://dolarhoy.com/',
    bgColor: '#064e3b',
    textColor: '#34d399'
  },
  {
    name: 'Cocos',
    url: 'https://app.cocos.capital/sign-in',
    bgColor: '#78350f',
    textColor: '#fbbf24'
  },
  {
    name: 'Noticias',
    url: 'https://www.google.com',
    bgColor: '#831843',
    textColor: '#f472b6'
  },
  {
    name: 'Calendario',
    url: 'https://www.google.com',
    bgColor: '#312e81',
    textColor: '#a5b4fc'
  }
]
</script>

<style scoped>

.quick-links {
  display: flex;
  align-items: center;
  justify-content: center;

  /* Ocupa el 80% de la pantalla y se centra */
  width: 80%;
  margin: 0 auto;

  /* Gap de 2em entre los botones */
  gap: 2em;

  padding: 10px;

  overflow-x: auto;

  scrollbar-width: none;
}

.quick-links::-webkit-scrollbar {
  display: none;
}


/* =====================================
   BOTONES
   ===================================== */

.quick-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;

  gap: 7px;

  height: 30px;

  padding: 0 12px;

  border: 1px solid #262b36;

  border-radius: 8px;

  text-decoration: none;

  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  
  /* Texto centrado */
  text-align: center;

  white-space: nowrap;

  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

/* Reset de estilos por defecto del navegador para el <button> */
button.quick-link {
  cursor: pointer;
  outline: none;
}

.quick-link-trades {
  font-weight: 700;
  border-color: #0d5c53 !important;
}

.quick-link-journal {
  font-weight: 700;
  border-color: #3730a3 !important;
}


/* =====================================
   ICONOS
   ===================================== */

.quick-link i {
  width: 14px;

  text-align: center;

  font-size: 11px;

  color: #8b96a8;
}


/* =====================================
   HOVER
   ===================================== */

.quick-link:hover {
  filter: brightness(1.2);
  border-color: #343b49;
}


/* =====================================
   CLICK
   ===================================== */

.quick-link:active {
  filter: brightness(0.9);
}


/* =====================================
   CELULAR
   ===================================== */

@media (max-width: 600px) {

  .quick-links {
    justify-content: flex-start;

    padding-left: 2px;
    padding-right: 2px;
  }

  .quick-link {
    height: 30px;

    padding: 0 10px;

    font-size: 11px;
  }

}

</style>