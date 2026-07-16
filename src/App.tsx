import { useEffect } from 'react';
import { useAppStore } from './store';
import { loadSettings } from './shared/lib/api';
import Toolbar from './Toolbar';
import FileList from './FileList';
import StatusBar from './StatusBar';

function App() {
  const { setSettings } = useAppStore();

  useEffect(() => {
    loadSettings()
      .then((loadedSettings) => setSettings(loadedSettings))
      .catch((error) => {
        console.error('Failed to load settings:', error);
      });
  }, [setSettings]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Toolbar />
      <FileList />
      <StatusBar />
    </div>
  );
}

export default App;
