// View-aware undo dispatch, mirroring paintBus. The mounted view registers
// its undo; palette + ⌘Z call undoBus.current without knowing the route.
// Routes unmount inactive views, so registration never collides (mpr/3d
// share a mount: only MPR registers, matching today's palette behavior).
export const undoBus: {
  current: () => void;
} = {
  current: () => {},
};
