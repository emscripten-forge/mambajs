const { exec } = require('child_process');
function buildWasm() {
  exec('./build_wasm.sh', (error, stdout, stderr) => {
    if (error) {
      console.error('Error:', error.message);
      return;
    }
    console.log('Output from script:', stdout);
  });
}

if (require.main === module) {
  buildWasm();
}
