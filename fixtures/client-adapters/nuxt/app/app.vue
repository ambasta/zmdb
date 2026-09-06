<script setup lang="ts">
import { useRequestURL } from '#app';

import { zmdb } from './zmdb.js';

const id = useRequestURL().searchParams.get('id') ?? 'missing';
const widget = await zmdb.useZmdbAsyncData('getWidget', { id }, (client, input, signal) =>
  client.getWidget(input, { signal }),
);
</script>

<template>
  <main :data-widget-id="widget.data.value?.id" :data-widget-name="widget.data.value?.name">
    {{ widget.data.value?.name }}
  </main>
</template>
