import { PluginManager, Hook } from "@server/utils/PluginManager";
import config from "../plugin.json";
import { MeilisearchSearchProvider } from "./MeilisearchSearchProvider";

const provider = new MeilisearchSearchProvider();

PluginManager.add([
  {
    ...config,
    type: Hook.SearchProvider,
    value: provider,
  },
]);
