<script>
  import { zmdb } from './bindings.mjs';

  const client = zmdb.getClient();
</script>

<strong>{client.label}</strong>
