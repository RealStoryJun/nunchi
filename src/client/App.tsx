import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Recover from './pages/Recover';
import Onboarding from './pages/Onboarding';
import Tutorial from './pages/Tutorial';
import Sales from './pages/Sales';
import Menus from './pages/Menus';
import BI from './pages/BI';
import Account from './pages/Account';
import Layout from './components/Layout';
import Protected from './components/Protected';

const protect = (el: React.ReactNode) => (
  <Protected>
    <Layout>{el}</Layout>
  </Protected>
);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/recover" element={<Recover />} />
      <Route
        path="/onboarding"
        element={
          <Protected requireBusinessType={false}>
            <Onboarding />
          </Protected>
        }
      />
      <Route
        path="/tutorial"
        element={
          <Protected>
            <Tutorial />
          </Protected>
        }
      />
      <Route path="/sales" element={protect(<Sales />)} />
      <Route path="/menus" element={protect(<Menus />)} />
      <Route path="/bi" element={protect(<BI />)} />
      <Route path="/account" element={protect(<Account />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
