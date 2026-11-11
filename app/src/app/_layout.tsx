import { Slot } from "expo-router";
import Companion from "../Companion";
export default function Layout() {
  // Native auth promises and the WebView must survive incoming deep links.
  return (
    <Companion>
      <Slot />
    </Companion>
  );
}
