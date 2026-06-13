<script lang="ts">
    interface Props { status: string }
    let { status }: Props = $props()
</script>

<div class="community-sync-wrap">
    <div class="community-loader"></div>
    <p class="community-sync-status">{status}</p>
    <div class="community-sync-bar"><div class="community-sync-bar-fill"></div></div>
</div>
