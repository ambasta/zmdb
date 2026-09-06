<script lang="ts">
  import { onNavigate } from '$app/navigation';

  import { navigation } from '$lib/navigation.js';

  let { children } = $props();

  onNavigate(value => {
    navigation.track(value);
  });
</script>

{@render children()}
