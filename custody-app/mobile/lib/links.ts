import { router, type Href } from 'expo-router';
import { isTabRoute, linkToRoute } from './routes';

export { linkToRoute, isTabRoute, routes } from './routes';

/** Open a notification link: switches tab for tab roots, pushes a screen otherwise. */
export function openLink(link: string | null | undefined): void {
  const route = linkToRoute(link);
  if (isTabRoute(route)) router.navigate(route as Href);
  else router.push(route as Href);
}
