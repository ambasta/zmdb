<script lang="ts">
  import { createQueryStore } from '@zmdb/sveltekit/client';

  const widget = createQueryStore(async () => ({
    id: 'client',
    name: 'browser graph',
  }));
</script>

<h1 data-client-widget>Client adapter graph</h1>
<button onclick={() => void widget.run()}>Load widget</button>
