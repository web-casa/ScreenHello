// Store identities come from the application records, never from another product.
const required = (env, name, pattern) => {
    const value = env[name];
    if (typeof value !== 'string' || !value || [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)) {
        throw new Error(`store-input-required:${name}`);
    }
    if (pattern && !pattern.test(value)) throw new Error(`store-input-invalid:${name}`);
    return value;
};

export const xml = (value) => String(value).replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[char]);

export const storeTargets = Object.freeze({
    mas: { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin', universal: 'universal-apple-darwin' },
    msix: { arm64: 'aarch64-pc-windows-msvc', x64: 'x86_64-pc-windows-msvc' },
});

export function storeInputs(channel, arch, env) {
    const target = Object.hasOwn(storeTargets, channel) && storeTargets[channel][arch];
    if (typeof target !== 'string') throw new Error('store-target-invalid');
    if (channel === 'mas') {
        return {
            channel, arch, target,
            identifier: required(env, 'SCREENHELLO_MAS_BUNDLE_ID', /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u),
            team: required(env, 'APPLE_TEAM_ID', /^[A-Z0-9]{10}$/u),
            buildNumber: required(env, 'SCREENHELLO_MAS_BUILD_NUMBER', /^[1-9]\d{0,3}(?:\.(?:0|[1-9]\d?)){0,2}$/u),
            appIdentity: required(env, 'SCREENHELLO_MAS_APP_IDENTITY', /^(?:Apple Distribution|3rd Party Mac Developer Application): .+ \([A-Z0-9]{10}\)$/u),
            installerIdentity: required(env, 'SCREENHELLO_MAS_INSTALLER_IDENTITY', /^3rd Party Mac Developer Installer: .+ \([A-Z0-9]{10}\)$/u),
            profile: required(env, 'SCREENHELLO_MAS_PROFILE'),
        };
    }
    const version = required(env, 'SCREENHELLO_MSIX_VERSION', /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.0$/u);
    if (version.split('.').some((n) => Number(n) > 65535) || Number(version.split('.')[0]) === 0) {
        throw new Error('store-input-invalid:SCREENHELLO_MSIX_VERSION');
    }
    return {
        channel, arch, target, version,
        name: required(env, 'SCREENHELLO_MSIX_IDENTITY_NAME', /^[A-Za-z0-9.-]{3,50}$/u),
        publisher: required(env, 'SCREENHELLO_MSIX_PUBLISHER', /^CN=.+$/u),
        publisherDisplayName: required(env, 'SCREENHELLO_MSIX_PUBLISHER_DISPLAY_NAME'),
        runtimeDirectory: required(env, 'SCREENHELLO_WEBVIEW2_RUNTIME_DIR'),
    };
}

export function masEntitlements(input) {
    if (!input.appIdentity.endsWith(`(${input.team})`) || !input.installerIdentity.endsWith(`(${input.team})`)) {
        throw new Error('store-certificate-team-mismatch');
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <!-- WKWebView's sandboxed process needs this even for bundled content.
       See tauri-apps/tauri-docs#3171; this does not start a network server. -->
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
  <key>com.apple.application-identifier</key><string>${xml(input.team)}.${xml(input.identifier)}</string>
  <key>com.apple.developer.team-identifier</key><string>${xml(input.team)}</string>
</dict></plist>
`;
}

export function msixManifest(input) {
    return `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
 xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
 xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
 IgnorableNamespaces="uap rescap">
 <Identity Name="${xml(input.name)}" Publisher="${xml(input.publisher)}" Version="${input.version}" ProcessorArchitecture="${input.arch}"/>
 <Properties><DisplayName>ScreenHello</DisplayName><PublisherDisplayName>${xml(input.publisherDisplayName)}</PublisherDisplayName><Logo>Assets\\StoreLogo.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0"/></Dependencies>
 <Resources><Resource Language="en-us"/><Resource Language="zh-cn"/><Resource Language="zh-tw"/><Resource Language="de-de"/><Resource Language="ko-kr"/><Resource Language="es-es"/><Resource Language="pt-pt"/></Resources>
 <Applications><Application Id="ScreenHello" Executable="screenhello-desktop.exe" EntryPoint="Windows.FullTrustApplication">
  <uap:VisualElements DisplayName="ScreenHello" Description="Local image editor" BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png"/>
 </Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust"/></Capabilities>
</Package>
`;
}

export function assertPeArchitecture(bytes, arch) {
    if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('store-pe-invalid');
    const offset = bytes.readUInt32LE(0x3c);
    if (offset < 64 || offset + 6 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') {
        throw new Error('store-pe-invalid');
    }
    if (!['x64', 'arm64'].includes(arch) || bytes.readUInt16LE(offset + 4) !== (arch === 'arm64' ? 0xaa64 : 0x8664)) {
        throw new Error('store-pe-architecture-mismatch');
    }
}
