from fibers.tree.node import ForestConnector

reader_port = 29999

def start_forest_server(host):
    forest_connector = ForestConnector(dev_mode=False,
                                       interactive_mode=True, host=host)
    print("Starting server at ", host)
    forest_connector.run()
    forest_connector.p.join()
    return forest_connector


if __name__ == '__main__':
    start_forest_server(f"0.0.0.0:{reader_port}")