/*
  Copyright © 1992-2021 Progress Software Corporation and/or one of its subsidiaries or affiliates. All rights reserved.
*/

/**
 * External functions from utils.js (loaded via script tag in fileView.html)
 * @external
 * @function link - Opens a URL in a new window
 * @function getRedirFromString - Generates redirect URL from help ID string
 */

window.addEventListener("DOMContentLoaded", function (event) {
    // MV3 Compatible: Use the link() function from utils.js instead of bg.link()
    document.getElementById('comparison').addEventListener("click", function () {
        link(getRedirFromString("compare-versions"));
    });

    document.getElementById('customer').addEventListener("click", function () {
        link(getRedirFromString("already-customer"));
    });

    // File System Access API ディレクトリ選択ボタンのハンドラ
    async function handleFileSystemAccessUpgrade() {
        try {
            // まず、保存されたハンドルの権限を再要求を試みる
            // ハンドルがない場合は、新しいディレクトリを選択
            let success;
            const backendType = afio.getBackendType();

            // File System Access バックエンドが設定されているが ready でない場合は、
            // 権限の再要求を試みる
            if (backendType === 'filesystem-access' && typeof afio.requestFileSystemAccessPermission === 'function') {
                console.log('[fileView] Requesting permission for saved directory...');
                success = await afio.requestFileSystemAccessPermission();
            } else {
                // それ以外の場合は、新しいディレクトリを選択
                console.log('[fileView] Prompting for new directory...');
                success = await afio.promptForFileSystemAccess();
            }

            if (success) {
                // ディレクトリ選択に成功したら、バナーを非表示にしてツリーを再構築
                document.getElementById('virtual-fs-upgrade-banner').setAttribute('hidden', 'true');
                document.getElementById('filesystem-access-message').setAttribute('hidden', 'true');
                var msg = document.getElementById('loading_message');
                msg.removeAttribute('hidden');
                TreeView.build();
                msg.setAttribute('hidden', true);
                window.parent.postMessage({ type: "selectionChanged", selected: TreeView.selectedItem != null }, "*");
            } else {
                alert('Directory selection was cancelled or failed. Please try again to access local files.');
            }
        } catch (err) {
            console.error('Failed to select directory:', err);
            alert('Failed to select directory: ' + err.message);
        }
    }

    const selectFsButton = document.getElementById('select-filesystem-button');
    if (selectFsButton) {
        selectFsButton.addEventListener('click', handleFileSystemAccessUpgrade);
    }

    const upgradeLink = document.getElementById('upgrade-to-real-fs');
    if (upgradeLink) {
        upgradeLink.addEventListener('click', function (e) {
            e.preventDefault();
            handleFileSystemAccessUpgrade();
        });
    }

    afio.isInstalled().then(function (installed) {
        // バックエンドタイプを確認して適切なUIを表示
        const backendType = afio.getBackendType();

        if (installed && backendType !== 'unknown') {
            // Check if ready (permission granted) for File System Access
            if (backendType === 'filesystem-access' && typeof afio.isReady === 'function' && !afio.isReady()) {
                const fsMessage = document.getElementById('filesystem-access-message');
                if (fsMessage) {
                    fsMessage.removeAttribute('hidden');
                    const title = fsMessage.querySelector('strong');
                    if (title) title.textContent = "Restore File Access";

                    const btn = document.getElementById('select-filesystem-button');
                    if (btn) btn.textContent = "Restore Access";
                }
                return; // Stop here, don't build tree yet
            }

            // ツリーを構築（Native, File System Access, Virtual すべて）
            var msg = document.getElementById('loading_message');
            msg.removeAttribute('hidden');
            TreeView.build();
            msg.setAttribute('hidden', true);
            window.parent.postMessage({ type: "selectionChanged", selected: TreeView.selectedItem != null }, "*");

            // Virtual FS使用中でFile System Access APIがサポートされている場合のみ、
            // アップグレードバナーを表示（ユーザーが実ファイルシステムを選択できるように）
            const shouldShowBanner = backendType === 'virtual' && afio.isFileSystemAccessSupported();

            if (shouldShowBanner) {
                const banner = document.getElementById('virtual-fs-upgrade-banner');
                if (banner) {
                    banner.removeAttribute('hidden');
                }
            }
        } else {
            // どのバックエンドも利用できない場合、フリーウェアメッセージを表示
            document.getElementById('no-file-io-message').removeAttribute("hidden");
        }
    }).catch(console.error.bind(console));
    document.body.oncontextmenu = function (e) {
        e.preventDefault()
    }
}, true);


var TreeView = {

    // predicate for sorting nodes
    sortPredicate: function (a, b) {
        // string compare function to sort nodes
        var node_compare = function (a, b) {

            //directories go first
            if (a.is_dir && !b.is_dir) {
                return -1;
            } else if (b.is_dir && !a.is_dir) {
                return 1;
            }

            var la = a.leafName.toLowerCase(),
                lb = b.leafName.toLowerCase();
            var bound = Math.min(la.length, lb.length);
            for (var i = 0; i < bound; i++) {
                var l = la.charAt(i), r = lb.charAt(i), x;
                if (l == r)
                    continue;
                // '#'-symbol preceeds others
                if (l == "#")
                    return -1;
                else if (r == "#")
                    return 1;
                else if (x = l.localeCompare(r))
                    return x;
            }
            return la.length - lb.length; // longer string is greater
        };
        if (a.is_dir && !b.is_dir) {
            return -1; 		// a dir always preceeds a file
        } else if (!a.is_dir && b.is_dir) {
            return 1;
        } else {
            return node_compare(a, b);
        }
    },

    // build tree from iMacros Macros folder
    build: function () {

        function selectMacroForPlayButton(id, name) {
            var div = document.getElementById("imacros-bookmark-div");
            if (div.hasAttribute("bookmark_id"))
                div.removeAttribute("bookmark_id");
            div.setAttribute("file_id", id);
            div.setAttribute("name", name);
        }

        let onEdit = function () { window.parent.postMessage({ type: "editMacro" }, "*"); }
        let onConvert = function () { window.parent.postMessage({ type: "convertMacro" }, "*"); }
        let onNewFolder = function () {
            var item = TreeView.selectedItem;
            var node = afio.openNode(item.id);

            if (item.type != "folder")
                node = node.parent;

            var _makedir_checkname = function (count, node, name) {
                var dir = node.clone();
                dir.append(name + " (" + count + ")");
                dir.exists().then(function (exists) {
                    if (exists) {
                        return _makedir_checkname(++count, node, name);
                    } else {
                        return afio.makeDirectory(dir).then(function () {
                            return jQuery('#jstree').jstree(true).refresh();
                        });
                    }
                }).catch(console.error.bind(console));
            };

            var new_name = prompt("Enter new folder name", "New folder");

            var dir = node.clone();
            dir.append(new_name);
            return dir.exists().then(function (exists) {
                if (exists) {
                    return _makedir_checkname(1, node, new_name);
                } else {
                    return afio.makeDirectory(dir).then(function (err) {
                        return jQuery('#jstree').jstree(true).refresh();
                    });
                }
            });
        }

        let onRename = function () {
            var item = TreeView.selectedItem;

            if (!item) {
                alert("Error: no item selected"); // should never happen
                return;
            }

            var old_name = item.text;
            var new_name = prompt("Enter new name", old_name);
            if (!new_name)
                return;
            if (item.type != "folder" && !isMacroFile(new_name))
                new_name += ".iim";
            var node = afio.openNode(item.id);
            var new_node = node.parent;
            new_node.append(new_name);

            node.moveTo(new_node).then(function () {

                jQuery('#jstree').jstree(true).refresh();

                if (item.type == "macro") {
                    TreeView.selectedItem.id = new_node.path;
                    TreeView.selectedItem.text = new_name;
                    selectMacroForPlayButton(new_node.path, new_name);
                }
            }).catch(console.error.bind(console));
        }

        let onRemove = function () {
            var item = TreeView.selectedItem;
            if (!item) {
                alert("Error: no item selected");
                return;
            }
            if (!item.id) {
                alert("Can not delete " + item.type + " " + item.text);
                return;
            }
            var yes = confirm("Are you sure you want to remove " + item.type + " " +
                item.text + "?");
            if (!yes)
                return;

            var node = afio.openNode(item.id);
            node.remove().then(function () {
                jQuery('#jstree').jstree(true).refresh();
                TreeView.selectedItem = null;
                selectMacroForPlayButton('', '');
            }).catch(console.error.bind(console));
        }
        let onRefreshTree = function () {
            jQuery('#jstree').jstree(true).refresh();
        }

        function customMenu(node) {
            TreeView.selectedItem = node.original;

            var items = {
                'Edit': {
                    'label': 'Edit',
                    'action': onEdit
                },
                'Convert': {
                    'label': 'Convert',
                    'action': onConvert
                },
                'New Folder': {
                    'label': 'New Folder',
                    'action': onNewFolder
                },
                'Rename': {
                    'label': 'Rename',
                    'action': onRename
                },
                'Remove': {
                    'label': 'Remove',
                    'action': onRemove
                },
                'Refresh Tree': {
                    'label': 'Refresh Tree',
                    'action': onRefreshTree
                }
            }

            if (node.type === 'folder') {
                delete items.Edit;
                delete items.Convert;
            }

            return items;
        };

        jQuery('#jstree').jstree({
            'core': {
                "check_callback": function (operation, node, parent, position, more) {
                    if (more.dnd && operation === "move_node") {
                        if (parent.id === "#") {
                            return false; // prevent moving a child above or below the root
                        }
                    }

                    return true; // allow everything else
                },

                'data': function (node, cb) { getNodes(node, cb); }
            },
            'types': {
                'folder': {

                },
                "macro": {
                    'icon': 'X'//'/skin/imglog.png'
                }
            },
            'contextmenu': {
                'items': customMenu
            },
            'plugins': ['state', 'dnd', 'types', 'contextmenu', 'wholerow']
        });

        jQuery(document).on('dnd_stop.vakata', function (e, data) {
            var src = afio.openNode(data.element.parentElement.id);
            var dst = afio.openNode(data.event.target.parentElement.id);

            dst.isDir().then(function (is_dir) {
                dst = is_dir ? dst : dst.parent;
                dst.path = dst._path = dst._path + __psep() + src.leafName;
                return src.moveTo(dst);
            }).then(function () {
                return jQuery('#jstree').jstree(true).refresh();
            }).catch(function (e) {
                console.error.bind(console);

                if (e && e.message) {
                    alert(e.message);
                }

                return jQuery('#jstree').jstree(true).refresh();
            });

            return false;
        });

        jQuery('#jstree').on('select_node.jstree', function (e, data) {
            TreeView.selectedItem = data.node;

            // ノード情報を親ウィンドウ(panel.js)へ送る
            let nodeInfo = {
                type: data.node.type,
                id: data.node.id,       // ファイルパス
                text: data.node.text    // マクロ名
            };

            if (data.node.type == 'macro') {
                TreeView.selectedItem.type = "macro";
                selectMacroForPlayButton(data.node.id, data.node.text);
                window.parent.postMessage({ type: "selectionChanged", selected: true }, "*");
                // MV3 Fix: Send full node info to panel
                window.parent.postMessage({
                    type: "iMacrosSelectionChanged",
                    node: nodeInfo
                }, "*");
                e.preventDefault();
                e.stopPropagation();
            }
            //folder
            else {
                TreeView.selectedItem.type = "folder";
                window.parent.postMessage({ type: "selectionChanged", selected: false }, "*");
                // MV3 Fix: Send full node info to panel
                window.parent.postMessage({
                    type: "iMacrosSelectionChanged",
                    node: nodeInfo
                }, "*");
            }
        });

        // Debounce flag to prevent double execution from event bubbling
        var playMacroDebounce = false;

        jQuery('#jstree').on('dblclick.jstree', function (e, data) {
            // Prevent event bubbling that can cause double execution
            e.stopPropagation();

            // Debounce check to prevent multiple rapid clicks
            if (playMacroDebounce) {
                console.log('[fileView] Ignoring duplicate dblclick (debounced)');
                return;
            }

            var target_node = jQuery('#jstree').jstree(true).get_node(e.target.parentElement.id);

            if (target_node && target_node.type == 'macro') {
                playMacroDebounce = true;
                // Post immediately for instant feedback
                window.parent.postMessage({ type: "playMacro" }, "*");
                // Reset debounce after a short delay to allow next play
                setTimeout(function() { playMacroDebounce = false; }, 300);
            }
        });

        jQuery('#jstree').on("loaded.jstree", function (event, data) {
            openFirstNode();
        })

        jQuery('#jstree').on("show_contextmenu.jstree", function (event, data) {

            var currentOffsetTop = $('.jstree-contextmenu').position().top - $(window).scrollTop();
            var menuHeight = $('.jstree-contextmenu').height() + 10;
            var tooLowBy = $(window.frameElement.parentElement).height() - (currentOffsetTop + menuHeight);

            if (tooLowBy < 0) {

                var newPosition = currentOffsetTop + tooLowBy + $(window).scrollTop();
                $('.jstree-contextmenu').offset({ top: newPosition })
            }
        })

        jQuery('#jstree').on('refresh.jstree', function (e, data) {
            openFirstNode();
        });

        function openFirstNode() {
            jQuery('#jstree').jstree("open_node", "ul > li:first");
        }

        function getNodes(node, cb) {

            var data_obj;

            if (node.id === "#") {

                afio.getDefaultDir("savepath").then(function (savepath) {
                    var root_node = savepath;

                    data_obj = createNode(root_node.leafName, root_node.path, 'folder', true);
                    data_obj.children = getChildren(root_node, data_obj, cb);
                }).catch(console.error.bind(console));
            }
            else {
                getChildren(afio.openNode(node.id), data_obj, cb);
            }
        }

        function getChildren(root_node, data_obj, cb) {

            afio.getNodesInDir(root_node)
                .then(function (nodes) {
                    // We need to sort array
                    nodes.sort(TreeView.sortPredicate);

                    var children = new Array();

                    for (var x of nodes) {
                        if (isMacroFile(x.path)) {
                            children.push(createNode(x.leafName, x.path, 'macro', false));
                        } else if (x.is_dir) {
                            children.push(createNode(x.leafName, x.path, 'folder', true));
                        }
                    }

                    if (data_obj && children.length) {
                        data_obj.children = children;
                        cb(data_obj);
                    } else if (children.length) {
                        cb(children);
                    } else if (data_obj) {
                        cb([data_obj]);
                    } else {
                        cb([]);
                    }
                }).catch(function (err) {
                    // Handle the case where the node is not a directory
                    if (err.message && err.message.includes('not a directory')) {
                        console.debug('[iMacros] Attempted to get children of non-directory node:', root_node.path);
                        // Return empty children array for non-directory nodes
                        if (data_obj) {
                            cb([data_obj]);
                        } else {
                            cb([]);
                        }
                    } else {
                        console.error('[iMacros] Error getting directory children:', err);
                        cb([]);
                    }
                });
        }

        function createNode(text, id, type, hasChildren) {
            return { 'text': text, 'id': id, 'type': type, 'children': hasChildren };
        }
    },

    refresh: function () {
        if (window.jQuery && jQuery('#jstree').length) {
            try {
                jQuery('#jstree').jstree(true).refresh();
            } catch (err) {
                console.warn('TreeView refresh failed', err);
            }
        }
    }
};
