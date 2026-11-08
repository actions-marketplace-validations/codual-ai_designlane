import SwiftUI

struct PlanRow: View {
    let title: String
    let price: String
    let selected: Bool

    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            Text(price)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).stroke(selected ? Color.accentColor : .gray))
    }
}

struct PlanRow_Previews: PreviewProvider {
    static var previews: some View { PlanRow(title: "Yearly", price: "$39.99", selected: true) }
}
