'use strict';

const utils = require('@iobroker/adapter-core');
const wifi = require('node-wifi');
const networkInterfaces = require('os').networkInterfaces;
const dns = require('dns');
const fs = require('fs');
const Netmask = require('netmask').Netmask;
const si = require('systeminformation');
const adapterName = require('./package.json').name.split('.').pop();
// const childProcess = require('child_process');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const configFile = __dirname + '/data/network.json';
const configTemplateFile = __dirname + '/data/network.template.json';

let stopping = false;
let cmdRunning = false;

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

const sudo = async command => {
    if (!stopping) {
        cmdRunning = command;
        const result = (await exec(`sudo ${command}`)).stdout.trim();
        adapter.log.debug(`Result for "SUDO ${command}": ${result}`);
        cmdRunning = false;
        return result;
    } else {
        return '';
    }

    //return childProcess.execSync(`echo ${password} | sudo -S command`).toString().trim();
    // return childProcess.execSync(command).toString().trim();
};

const justExec = async command => {
    if (!stopping) {
        cmdRunning = command;
        const result = (await exec(command)).stdout.trim();
        adapter.log.debug(`Result for "${command}": ${result}`);
        cmdRunning = false;
        return result;
    } else {
        return '';
    }

    // return childProcess.execSync(`echo ${password} | sudo -S command`).toString().trim();
    // return childProcess.execSync(command).toString().trim();
};


const argumentEscape = argument => {
    return `'${argument.replace(/'/, /\\'/g)}'`;
};

const getConfig = () => {
    if (!fs.existsSync(configFile)) {
        fs.copyFileSync(configTemplateFile, configFile);
    }

    return JSON.parse(fs.readFileSync(configFile).toString());
};

const setConfig = config => {
    if (!fs.existsSync(configFile)) {
        fs.copyFileSync(configTemplateFile, configFile);
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 4));
};

const wifiConnect = async (ssid, password, iface) => {
    const config = getConfig();
    config[iface].wifi = ssid;
    config[iface].wifiPassword = !!password;
    setConfig(config);
    if (password) {
        const wpaSupplicant = `
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=RU

network={
    ssid="${ssid}"
    psk="${password}"
    key_mgmt=WPA-PSK
}
`;

        await justExec(`echo ${argumentEscape(wpaSupplicant)} | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf`);
        // fs.writeFileSync(wpaSupplicantFile, wpaSupplicant);
    } else {
        const wpaSupplicant = `
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=RU

network={
    ssid="${ssid}"
    key_mgmt=NONE
}
`;
        await justExec(`echo ${argumentEscape(wpaSupplicant)} | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf`);
        // fs.writeFileSync(wpaSupplicantFile, wpaSupplicant);
    }
    // await sudo('service wpa_supplicant restart');
    await writeInterfaces(true);
};

const wifiDisconnect = async iface => {
    const config = getConfig();
    delete config[iface].wifi;
    delete config[iface].wifiPassword;
    setConfig(config);
    const wpaSupplicant = `
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
country=RU
    `;
    await justExec(`echo ${argumentEscape(wpaSupplicant)} | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf`);
    if (!stopping) {
        // fs.writeFileSync(wpaSupplicantFile, wpaSupplicant);
        // await sudo('wpa_cli reconfigure');
        await writeInterfaces(true);
    }
};

const writeInterfaces = async wifiOnly => {
    const config = getConfig();
    let interfaces = `
hostname
clientid
persistent
option rapid_commit
option domain_name_servers, domain_name, domain_search, host_name
option classless_static_routes
option interface_mtu
require dhcp_server_identifier
slaac private    
`;

    Object.keys(config).forEach(iface => {
        const ifaceConfig = config[iface];
        const dns = ifaceConfig.dns && ifaceConfig.dns.join(' ').trim() ?
            `static domain_name_servers=${ifaceConfig.dns.join(' ')}` : '';

        interfaces += ifaceConfig.dhcp ? `
        ` : `
interface ${iface}
static ip_address=${ifaceConfig.ip4}/${new Netmask(ifaceConfig.ip4 + '/' + ifaceConfig.ip4subnet).bitmask}
static routers=${ifaceConfig.ip4gateway}
${dns}
# static ip6_address=${ifaceConfig.ip6}/${ifaceConfig.ip6subnet}
        `;
    });

    console.log(interfaces);
    await justExec(`echo ${argumentEscape(interfaces)} | sudo tee /etc/dhcpcd.conf`);

    if (!stopping) {
        // fs.writeFileSync(interfacesFile, interfaces);

        const interfaces = await consoleGetInterfaces();
        for (const k in interfaces) {
            await sudo(`ip addr flush ${interfaces[k]}`);
            if (interfaces[k].startsWith('w')) {
                await sudo(`ifconfig ${interfaces[k]} down`);
                await sudo(`ifconfig ${interfaces[k]} up`);
            }
        }
        await sudo('service dhcpcd restart');
    }
};

const getWiFi = async () => {
    const networks = [];
    const iwlist = await sudo('iwlist scan');

    if (!stopping) {
        let currentNetwork = null;
        iwlist.split('\n').forEach(line => {
            line = line.trim();
            if (line.startsWith('Cell')) {
                currentNetwork = {security: []};
                networks.push(currentNetwork);
            }
            let matches;
            if ((matches = line.match(/^ESSID:"(.*)"/))) {
                currentNetwork.ssid = matches[1];
            }
            if ((matches = line.match(/Signal level=(.*) dBm/))) {
                currentNetwork.quality = matches[1];
            }
            if (line.match(/Encryption key:off/)) {
                currentNetwork.security.push('Open');
            }
            if (line.match(/IE: WPA Version 1/)) {
                currentNetwork.security.push('WPA');
            }
            if (line.match(/IEEE 802\.11i\/WPA2 Version 1/)) {
                currentNetwork.security.push('WPA2');
            }
        });
    }

    return networks;
};

const getWiFiConnections = async () => {
    let ssid = null;
    try {
        ssid = await justExec('iwgetid -r');
    } catch (e) {
        //adapter.log.warn('Cannot execute "iwgetid": ' + e);
    }
    return ssid ? [{ssid}] : [];
};

const consoleGetInterfaces = async () =>
    (await justExec('ip a | grep -P \'^[0-9]+:\''))
        .split('\n')
        .map(iface => iface.match(/^[0-9]+: (.*?):/)[1])
        .filter(iface => iface !== 'lo');

const triggers = {
    interfaces: async (input, response) => {
        si.networkInterfaces(async result => {
            if (process.platform === 'win32') {
                const nativeInterfaces = networkInterfaces();
                response(result.map(interfaceItem => {
                    interfaceItem.iface = Object.keys(nativeInterfaces).find(key => nativeInterfaces[key][0].mac === interfaceItem.mac);
                    return interfaceItem;
                }));
            } else {
                const consoleInterfaces = (await consoleGetInterfaces()).map(consoleInterface => ({
                    iface: consoleInterface,
                    ip4: '',
                    ip4subnet: '',
                    ip6: '',
                    ip6subnet: '',
                    gateway: '',
                    dhcp: false,
                }));

                consoleInterfaces.forEach(consoleInterface => {
                    if (!result.find(interfaceItem => interfaceItem.iface === consoleInterface.iface)) {
                        result.push(consoleInterface);
                    }
                });

                const config = getConfig();

                result.forEach(interfaceItem => {
                    if (config[interfaceItem.iface]) {
                        interfaceItem.dhcp = config[interfaceItem.iface].dhcp;
                        interfaceItem.type = interfaceItem.iface[0] === 'w' ? 'wireless' : 'wired';
                        if (!interfaceItem.dhcp) {
                            interfaceItem.dns = config[interfaceItem.iface].dns || [''];
                            interfaceItem.ip4 = config[interfaceItem.iface].ip4 || '';
                            interfaceItem.ip4subnet = config[interfaceItem.iface].ip4subnet || '';
                            // interfaceItem.ip6 = config[interfaceItem.iface].ip6 || '';
                            // interfaceItem.ip6subnet = config[interfaceItem.iface].ip6subnet || '';
                            interfaceItem.gateway = config[interfaceItem.iface].ip4gateway || '';
                        } else {
                            interfaceItem.dns = [];
                        }
                    }
                });
                response(result);
            }
        });
    },
    wifi: async (input, response) => {
        if (process.platform === 'win32') {
            si.wifiNetworks(response);
        } else {
            response(await getWiFi());
        }
    },
    dns: (input, response) => {
        response(dns.getServers());
    },
    changeDns: (input/*, response*/) => {
        console.log(input.data);
    },
    wifiConnections: async (input, response) => {
        if (process.platform === 'win32') {
            si.wifiConnections(response);
        } else {
            response(await getWiFiConnections());
        }
    },
    wifiConnect: async (input, response) => {
        if (process.platform === 'win32') {
            wifi.init({iface: null});

            wifi.connect({ ssid: input.ssid, password: input.password }, error => {
                if (error) {
                    response({result: false, error: error});
                } else {
                    response({result: true});
                }
            });
        } else {
            await wifiConnect(input.ssid, input.password, input.iface);

            try {
                response({result: (await justExec('iwgetid -r')) === 'input.ssid'});
            } catch (err) {
                response({result: true});
            }
        }
    },
    wifiDisconnect: async (input, response) => {
        if (process.platform === 'win32') {
            wifi.init({iface: null});

            await wifi.disconnect(error => {
                if (error) {
                    response({result: false, error: error});
                } else {
                    response({result: true});
                }
            });
        } else {
            wifiDisconnect(input.iface);
            response({result: true});
        }
    },
    changeInterface: async (input, response) => {
        if (process.platform === 'win32') {
            if (input.rootPassword !== 'test') {
                response(false);
            }
        } else {
            const config = getConfig();

            config[input.data.iface] = input.data.dhcp ?
                {dhcp: true}
                : {
                    dhcp: false,
                    ip4: input.data.ip4,
                    ip4subnet: input.data.ip4subnet,
                    // ip6: input.data.ip6,
                    // ip6subnet: input.data.ip6subnet,
                    ip4gateway: input.data.gateway,
                    dns: input.data.dns,
                };
            setConfig(config);
            await writeInterfaces();
        }
        response(true);
    },
};

function waitForEnd(callback, _started) {
    _started = _started || Date.now();
    if (cmdRunning && Date.now() - _started < 4000) {
        setTimeout(waitForEnd, 500, callback, _started);
    } else {
        callback && callback(Date.now() - _started >= 4000);
    }
}

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: adapterName,

        // The ready callback is called when databases are connected and adapter received configuration.
        // start here!
        ready: async () => {
            await main();
        },
        unload: callback => {
            stopping = true;
            waitForEnd(timeout => {
                timeout && adapter.log.warn('Timeout by waiting of command: ' + cmdRunning);
                callback && callback();
            });
        },
        message: obj => {
            if (typeof obj === 'object' && obj.callback) {
                const response = result => {
                    adapter.sendTo(obj.from, obj.command, result, obj.callback);
                };

                if (triggers[obj.command]) {
                    triggers[obj.command](obj.message, response);
                } else {
                    // error
                }
            }
        }
    }));
}

async function main() {
    if (!fs.existsSync('/etc/dhcpcd.conf.bak')) {
        await sudo('cp /etc/dhcpcd.conf /etc/dhcpcd.conf.bak');
    }
    /*try {
        if (fs.existsSync(interfacesFile)) {
            if (!fs.existsSync(interfacesFile + '.bak')) {
                fs.writeFileSync(`${interfacesFile}.bak`, fs.readFileSync(interfacesFile));
            }
        } else if (fs.existsSync('/etc/dhcp/dhclient.conf')) {
            interfacesFile = '/etc/dhcp/dhclient.conf';
            if (!fs.existsSync(interfacesFile + '.bak')) {
                fs.writeFileSync(`${interfacesFile}.bak`, fs.readFileSync(interfacesFile));
            }
        } else {
            adapter.log.warn('Cannot find DHCP file. Nether /etc/dhcp/dhclient.conf nor /etc/dhcpcd.conf exist');
            interfacesFile = null;
        }
    } catch (e) {
        adapter.log.error(`Cannot write ${interfacesFile}. Please call "sudo chown iobroker ${interfacesFile}" in shell!`)
    }

    try {
        if (fs.existsSync(wpaSupplicantFile)) {
            fs.readFileSync(wpaSupplicantFile);
        } else {
            wpaSupplicantFile = null;
        }
    } catch (e) {
        adapter.log.error(`Cannot read ${wpaSupplicantFile}. Please call "sudo chown iobroker ${wpaSupplicantFile}" in shell!`)
    }*/
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}
