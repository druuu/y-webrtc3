var pkg = require('./package.json')

export default {
  entry: 'src/y-webrtc.js',
  moduleName: 'ywebrtc',
  format: 'cjs',
  dest: 'y-webrtc.node.js',
  sourceMap: true,
  external: [
    'socket.io-client'
  ],
  banner: `
/**
 * ${pkg.name} - ${pkg.description}
 * @version v${pkg.version}
 * @license ${pkg.license}
 */
`
}
