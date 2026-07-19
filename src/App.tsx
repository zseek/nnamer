import { useEffect } from 'react';
import { useAppStore } from './store';
import { loadSettings } from './shared/lib/api';
import Toolbar from './Toolbar';
import FileList from './FileList';
import StatusBar from './StatusBar';
import Logger from './Logger';
import DesktopInteractionLayer from './DesktopInteractionLayer';

function App() {
  const { setSettings, showLogger, setShowLogger } = useAppStore();

  useEffect(() => {
    loadSettings()
      .then((loadedSettings) => setSettings(loadedSettings))
      .catch((error) => {
        console.error('Failed to load settings:', error);
      });
  }, [setSettings]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <DesktopInteractionLayer />
      <Toolbar />
      <FileList />
      <StatusBar />
      <Logger isOpen={showLogger} onClose={() => setShowLogger(false)} />
    </div>
  );
}

export default App;
