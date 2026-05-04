import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Remove Liveblocks "Powered by" badge injected into the DOM
const removeLiveblocksLogo = () => {
  document.querySelectorAll('a[href*="liveblocks.io"]').forEach(el => el.remove());
};
const observer = new MutationObserver(removeLiveblocksLogo);
observer.observe(document.body, { childList: true, subtree: true });
removeLiveblocksLogo();

createRoot(document.getElementById("root")!).render(<App />);
