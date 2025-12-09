
/*
Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/


// Provides access to files using Native Messaging Host technology


var afio = (function () {
    const fio_host = "com.ipswitch.imacros.fio";

    function NodeObject(transferrable_node) {
        if (!transferrable_node || !transferrable_node._path)
            throw new Error("NodeObject can not be constructed");
        this._path = transferrable_node._path;
        if (typeof(transferrable_node._is_dir_int) != "undefined")
            this._is_dir_int = transferrable_node._is_dir_int;
    };

    NodeObject.prototype.__defineGetter__("path", function() {
        return this._path;
    });

    NodeObject.prototype.__defineGetter__("leafName", function() {
        // special treatment of root dir or drive letters
        if (__is_windows()) {
            if (/^[a-z]:\\?$/i.test(this._path))
                return "";
        } else {
            if (this._path == "/")
                return "";
        }

        return this._path.split(__psep()).pop();
    });

    NodeObject.prototype.__defineGetter__("parent", function() {
        // special treatment of root dir or drive letters
        // return the node itself
        if (__is_windows()) {
            if (/^[a-z]:\\?$/i.test(this._path))
                return new NodeObject(this);
        } else {
            if (this._path == "/")
                return new NodeObject(this);
        }

        var a = this._path.split(__psep()); a.pop();
        if (!__is_windows() && a.length == 1 && a[0] == "")
            a[0] = "/";
        return new NodeObject({_path: a.join(__psep())});
    });

    NodeObject.prototype.__defineGetter__("isDirCached", function() {
        return typeof(this._is_dir_int) != "undefined";
    });

    NodeObject.prototype.__defineGetter__("is_dir", function() {
        return this._is_dir_int;
    });

    NodeObject.prototype.exists = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            var req = {method: "node_exists", node: self};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(result.exists);
            });
        });
    };


    NodeObject.prototype.isDir = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            if (self.isDirCached) {
                resolve(self.is_dir);
                return;
            }
            var req = {method: "node_isDir", node: self};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(result.isDir);
            });
        });
    };


    NodeObject.prototype.isWritable = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            var req = {method: "node_isWritable", node: self};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(result.isWritable);
            });
        });
    };


    NodeObject.prototype.isReadable = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            var req = {method: "node_isReadable", node: self};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(result.isReadable);
            });
        });
    };


    // append part of the name
    NodeObject.prototype.append = function(bit) {
        while (bit[0] == __psep())
            bit = bit.substring(1);
        this._path += this._path[this._path.legnth-1] == __psep() ?
            bit : __psep()+bit;
    };

    NodeObject.prototype.clone = function() {
        return new NodeObject(this);
    };

    // copyTo(NodeObject dest)
    NodeObject.prototype.copyTo = function(node) {
        var self = this;
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("NodeObject.copyTo() no dest node provided"));
                return;
            }
            var req = {method: "node_copyTo", src: self, dst: node};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve();
            });
        });
    };


    // moveTo(NodeObject dest)
    NodeObject.prototype.moveTo = function(node) {
        var self = this;
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("NodeObject.moveTo() no dest node provided"));
                return;
            }
            var req = {method: "node_moveTo", src: self, dst: node};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve();
            });
        });
    };


    // remove()
    NodeObject.prototype.remove = function() {
        var self = this;
        return new Promise(function(resolve, reject) {
            var req = {method: "node_remove", node: self};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(undefined, new Error(result.error));
                    return;
                }

                resolve();
            });
        });
    };


    // afio implementation
    var obj = {};

    /* Quick test for the availability of the host */
    obj.isInstalled = function() {
        return new Promise(function(resolve, reject) {
            var req = {method: "isInstalled", version:Storage.getChar("version")};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                resolve(!chrome.runtime.lastError);
            });
        });
    };

    /* Query limits */
    obj.queryLimits = function() {
        return new Promise(function(resolve, reject) {
            var req = {method: "queryLimits"};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if(chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError)
                } else if (result.error) {
                    reject(result.error)
                } else {
                    resolve(result)
                }
            });
        });
    };


    /*
      openNode(String path)
    */
    obj.openNode = function(path) {
        if (!path) throw new Error("afio.openNode() no path provided");
        return new NodeObject({_path: path});
    };


    /*
      readTextFile(NodeObject node)
        returns the content of for the given node object or error in case file
        can not be read.
    */
    obj.readTextFile = function(node) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("afio.readTextFile() no file node provided"));
                return;
            }
            var req = {method: "readTextFile", node: node};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve(result.data);
            });
        });
    };


    /*
     writeTextFile(NodeObject node, String data)
       resolves with no arguments on success
    */

    obj.writeTextFile = function(node, data) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("afio.writeTextFile() no file node provided"));
                return;
            }
            var req = {method: "writeTextFile", node: node, data: (data || "")};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve();
            });
        });
    };

    /*
      appendTextFile(NodeObject node, String data)
        resolves with no arguments on success
    */

    obj.appendTextFile = function(node, data) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("afio.appendTextFile() no file provided"));
                return;
            }
            var req = {method: "appendTextFile",
                       node: node, data: (data || "")};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }
                resolve();
            });
        });
    };


    /*
     getNodesIndir(NodeObject node, [optional] String filter)
        resolves with an array of nodes representing directory listing.
    */
    obj.getNodesInDir = function(node, filter) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("afio.getNodesInDir() no file node provided"));
                return;
            }
            node.isDir().then(function(is_dir) {
                if (!is_dir) {
                    reject(new Error(
                        "afio.getNodesInDir() node is not a directory"
                    ));
                    return;
                }
                var req = {method: "getNodesInDir", node: node};
                if (typeof filter == "string")
                    req.filter = filter;
                chrome.runtime.sendNativeMessage(
                    fio_host, req, function(result) {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                            return;
                        }

                        if (result.error) {
                            reject(new Error(result.error));
                            return;
                        }

                        if (typeof(filter) == "function")
                            resolve(result.nodes.map(function(x) {
                                return new NodeObject(x);
                            }).filter(filter));
                        else
                            resolve(result.nodes.map(function(x) {
                                return new NodeObject(x);
                            }));
                    }
                );
            }).catch(reject);
        });
    };

    /*
     getLogicalDrives()
        resolves with an array of nodes representing root logical drives on
        Windows or just an array containing single element "/" for *nix system.
    */
    obj.getLogicalDrives = function() {
        return new Promise(function(resolve, reject) {
            var req = {method: "getLogicalDrives"};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve(result.nodes.map(function(x) {
                    return new NodeObject(x);
                }));
            });
        });
    };


    /*
     getDefaultDir(String name)
        resolves with a node for the corresponding default dir or null if
        it hasn't been set yet.
    */
    obj.getDefaultDir = function(name) {
        var self = this;
        return new Promise(function(resolve, reject) {
            if (!/^(?:downpath|datapath|logpath|savepath)$/.test(name)) {
                reject(new Error("afio.getDefaultDir() wrong dir name "+name));
                return;
            }

            if (localStorage["def"+name]) {
                resolve(self.openNode(localStorage["def"+name]));
                return;
            }

            // not initialized yet, so we have to ask host to do that
            var req = {method: "getDefaultDir", name: name};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }
                resolve(new NodeObject(result.node));
            });
        });
    };

    /*
     makeDirectory(NodeObject node)
        resolves with no arguments on success
    */
    obj.makeDirectory = function(node) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(new Error("afio.makeDirectory() node is not provided"));
                return;
            }

            var req = {method: "makeDirectory", node: node};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                if (result.error) {
                    reject(new Error(result.error));
                    return;
                }

                resolve();
            });
        });
    };

    /*
     writeImageToFile(NodeObject node, imageDataType imageData)
      imageDataType is
       {
        image: <base64 encoded string>,
        encoding: <encoding type, now only base64 supported>,
        mimeType: <image MIME type>
       };
      resolves with no arguments on success
    */
    obj.writeImageToFile = function(node, data) {
        return new Promise(function(resolve, reject) {
            if (!node) {
                reject(
                    new Error("afio.writeImageToFile() node is not provided")
                );
                return;
            }

            if (!data || !data.image || !data.encoding || !data.mimeType) {
                reject(
                    new Error("afio.writeImageToFile() imageData is "+
                              "not provided or has wrong type")
                );
                return;
            }

            var req = {method: "writeImageToFile", node: node, imageData: data};
            chrome.runtime.sendNativeMessage(fio_host, req, function(result) {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                resolve();
            });
        });
    };


    return obj;
}) ();
