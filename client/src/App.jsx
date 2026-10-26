import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import useSession from './lib/session.js';

const Home = lazy(() => import('./pages/Home.jsx'));
const RoomPage = lazy(() => import('./pages/RoomPage.jsx'));
const ContainerPage = lazy(() => import('./pages/ContainerPage.jsx'));
const ItemPage = lazy(() => import('./pages/ItemPage.jsx'));
const MirrorPage = lazy(() => import('./pages/MirrorPage.jsx'));

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

/** Sin sesión no se pasa: vuelve al pasillo y la puerta pide la contraseña */
function RequireSession({ children }) {
  const session = useSession();
  const { roomId } = useParams();
  const location = useLocation();
  if (!session) {
    return <Navigate to="/" replace state={{ ask: roomId, next: location.pathname + location.search }} />;
  }
  return children;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<RequireSession><RoomPage /></RequireSession>} />
          <Route path="/room/:roomId/espejo" element={<RequireSession><MirrorPage /></RequireSession>} />
          <Route path="/room/:roomId/:container" element={<RequireSession><ContainerPage /></RequireSession>} />
          <Route path="/room/:roomId/:container/:itemId" element={<RequireSession><ItemPage /></RequireSession>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
